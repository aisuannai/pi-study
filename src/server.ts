import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { authenticate, AuthError, type AuthUser } from "./auth.ts";
import { UserQueue } from "./queue.ts";
import {
  getOrCreate,
  initModelRuntime,
  setApprovalNotifier,
  allEntries,
} from "./sessions-persistent.ts";
import { resolveApproval } from "./approvals.ts";
import { createObserver } from "./observe.ts";

function sseWrite(res: ServerResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function readJson(req: IncomingMessage): Promise<{ message?: string; approve?: boolean }> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk;
      if (data.length > 100_000) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); } catch { reject(new Error("bad json")); }
    });
    req.on("error", reject);
  });
}

async function main(): Promise<void> {
  const modelRuntime = await initModelRuntime();
  const streams = new Map<string, Set<ServerResponse>>(); // userId → 活跃 SSE 连接
  const queues = new Map<string, UserQueue>();

  // 审批卡从这里推到前端（sessions 模块回调进来，避免循环依赖）
  setApprovalNotifier((approval) => {
    for (const res of streams.get(approval.userId) ?? []) {
      sseWrite(res, {
        type: "approval_required",
        id: approval.id,
        toolName: approval.toolName,
        args: approval.argsSummary,
      });
    }
  });

  const server = createServer(async (req, res) => {
    const url = req.url ?? "";
    const method = req.method ?? "";

    // ① 健康检查：给容器探针用，不走认证
    if (method === "GET" && url === "/healthz") {
      res.writeHead(200).end("ok");
      return;
    }

    // ② 真实认证：替代 x-user-id 占位
    let user: AuthUser;
    try {
      user = authenticate(req);
    } catch (error) {
      const status = error instanceof AuthError ? error.status : 401;
      res.writeHead(status).end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    // ③ 审批端点：只有本人能批本人的操作
    if (method === "POST" && url.startsWith("/approvals/")) {
      const body = await readJson(req);
      const ok = resolveApproval(url.slice("/approvals/".length), user.userId, body.approve === true);
      res.writeHead(ok ? 200 : 404).end(JSON.stringify({ ok }));
      return;
    }

    if (method !== "POST" || url !== "/chat") {
      res.writeHead(404).end();
      return;
    }

    // ④ 输入校验
    const body = await readJson(req);
    const message = body.message?.trim() ?? "";
    if (message.length === 0 || message.length > 4000) {
      res.writeHead(400).end("invalid message");
      return;
    }

    // ⑤ 懒建会话（并发安全，实战篇 01）
    const entry = await getOrCreate(user.userId, modelRuntime);

    // ⑥ SSE 响应头
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });

    // ⑦ 白名单事件流（高级篇 K：delta 渲染，end 落库）
    let closed = false;
    const unsubscribe = entry.session.subscribe((event: AgentSessionEvent) => {
      if (closed) return;
      switch (event.type) {
        case "message_update":
          if (event.assistantMessageEvent.type === "text_delta") {
            sseWrite(res, { type: "delta", delta: event.assistantMessageEvent.delta });
          }
          break;
        case "tool_execution_start":
          sseWrite(res, { type: "tool_start", toolName: event.toolName });
          break;
        case "tool_execution_end":
          sseWrite(res, { type: "tool_end", isError: event.isError });
          break;
      }
    });
    if (!streams.has(user.userId)) streams.set(user.userId, new Set());
    streams.get(user.userId)!.add(res);

    // ⑧ 断连：停止订阅 + 取消当前运行
    res.on("close", () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      streams.get(user.userId)?.delete(res);
      if (entry.running) void entry.session.abort();
    });

    // ⑨ 忙时排队（6.2）：不再 409，有上限有超时
    const queue = queues.get(user.userId) ?? new UserQueue(5, 30_000);
    queues.set(user.userId, queue);

    try {
      await queue.push(async () => {
        if (closed) return; // 排到队首时客户端早走了
        const observer = createObserver(user.userId); // 6.5：trace + usage
        const unsubscribeObserver = entry.session.subscribe(observer);
        try {
          entry.running = true; // 同步占坑（实战篇修过的竞态）
          await entry.session.prompt(message);
          if (!closed) sseWrite(res, { type: "final", text: entry.session.getLastAssistantText() ?? "" });
        } catch {
          entry.running = false; // prompt 没进 run 就失败时，事件不会兜底，这里手动放行
          if (!closed) sseWrite(res, { type: "error", message: "服务暂时不可用，请稍后重试" });
        } finally {
          unsubscribeObserver();
        }
      });
    } catch (error) {
      // 队列满 / 排队超时：把明确的原因告诉客户端
      if (!closed) {
        sseWrite(res, { type: "error", message: error instanceof Error ? error.message : "请稍后重试" });
      }
    } finally {
      unsubscribe();
      if (!closed) res.end();
    }
  });

  // ⑩ 优雅停机：SIGTERM → 停接新请求 → 等所有会话空闲 → 清理 → 退出
  process.on("SIGTERM", () => {
    console.log("SIGTERM：停止接新请求，等在跑的任务结束……");
    server.close(async () => {
      const entries = await allEntries();
      await Promise.all(entries.map((e) => e.session.waitForIdle())); // agent_settled 语义
      for (const e of entries) e.session.dispose();
      await modelRuntime.settleCredentialWrites(); // 别丢刚刷新的 OAuth 令牌
      console.log("已优雅退出");
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 15_000).unref(); // 兜底：之后编排层会 SIGKILL
  });

  server.listen(8787, () => console.log("listening on http://localhost:8787"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
