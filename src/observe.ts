import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

const dataRoot = join(process.cwd(), "data");

function userFile(kind: string, userId: string): string {
  const dir = join(dataRoot, kind);
  mkdirSync(dir, { recursive: true });
  return join(dir, `${userId.replace(/[^a-zA-Z0-9_-]/g, "_")}.jsonl`);
}

function line(file: string, value: unknown): void {
  appendFileSync(file, JSON.stringify(value) + "\n");
}

/** trace + usage 订阅器：给每个用户会话挂一份（server.ts 里每次 run 挂上、收尾摘掉）。 */
export function createObserver(userId: string): (event: AgentSessionEvent) => void {
  const traceFile = userFile("trace", userId);
  const usageFile = userFile("usage", userId);

  const pendingTools = new Map<string, { toolName: string; t0: number }>();
  let runT0 = 0;

  return (event: AgentSessionEvent) => {
    const now = Date.now();
    switch (event.type) {
      case "agent_start":
        runT0 = now;
        line(traceFile, { kind: "run", phase: "start", ts: now });
        break;

      case "message_end": {
        // usage 的权威版本只在 message_end 的消息上（高级篇 K.4）
        if (event.message.role === "assistant" && event.message.usage) {
          const u = event.message.usage;
          line(usageFile, {
            ts: now,
            input: u.input ?? 0,
            output: u.output ?? 0,
            cacheRead: u.cacheRead ?? 0,
            costTotal: u.cost?.total ?? 0,
          });
        }
        break;
      }

      case "tool_execution_start":
        pendingTools.set(event.toolCallId, { toolName: event.toolName, t0: now });
        break;

      case "tool_execution_end": {
        const started = pendingTools.get(event.toolCallId);
        pendingTools.delete(event.toolCallId);
        // 被拦截的调用没有 durationMs：它没真正执行（第 07 课的时序提醒）
        line(traceFile, {
          kind: "tool",
          toolName: started?.toolName,
          durationMs: event.durationMs,
          isError: event.isError,
          ts: now,
        });
        break;
      }

      case "agent_settled":
        // 用户视角的“做完”：含重试与排队。算总时长不用 agent_end
        line(traceFile, {
          kind: "run",
          phase: "end",
          durationMs: now - runT0,
          aborted: event.aborted,
          ts: now,
        });
        otlpExport(userId, {
          name: "agent.run",
          t0: runT0,
          t1: now,
          attrs: { "user.id": userId, "run.aborted": event.aborted },
        });
        break;
    }
  };
}

// —— OTLP/HTTP JSON 零依赖导出：观测不拖垮业务，失败静默 ——

type Span = {
  name: string;
  t0: number;
  t1: number;
  attrs: Record<string, string | number | boolean>;
};

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT; // 如 http://localhost:4318

function otlpAttr(value: string | number | boolean) {
  if (typeof value === "string") return { value: { stringValue: value } };
  if (typeof value === "boolean") return { value: { boolValue: value } };
  return { value: { intValue: String(value) } };
}

function otlpExport(resource: string, span: Span): void {
  if (!otlpEndpoint) return;
  const nanos = (ms: number) => (BigInt(ms) * 1_000_000n).toString();
  void fetch(`${otlpEndpoint}/v1/traces`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      resourceSpans: [
        {
          resource: {
            attributes: [{ key: "service.name", value: { stringValue: "data-agent" } }],
          },
          scopeSpans: [
            {
              scope: { name: resource },
              spans: [
                {
                  // 教学简化：每个 run 独立 trace。生产用 W3C Trace Context
                  // 把 HTTP 请求的 traceparent 传进 agent span，串成一条链
                  traceId: randomUUID().replaceAll("-", "").slice(0, 32),
                  spanId: randomUUID().replaceAll("-", "").slice(0, 16),
                  name: span.name,
                  kind: "SPAN_KIND_INTERNAL",
                  startTimeUnixNano: nanos(span.t0),
                  endTimeUnixNano: nanos(span.t1),
                  attributes: Object.entries(span.attrs).map(([key, value]) => ({
                    key,
                    ...otlpAttr(value),
                  })),
                },
              ],
            },
          ],
        },
      ],
    }),
  }).catch(() => {});
}
