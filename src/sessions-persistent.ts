import { mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { querySalesTool } from "./tools/query-sales.ts";
import { createTicketToolFor } from "./tools/create-ticket.ts";
import { createApprovalGate, type PendingApproval } from "./approvals.ts";

export type UserEntry = {
  session: AgentSession;
  running: boolean;
};

const registry = new Map<string, Promise<UserEntry>>();
const sessionsRoot = join(process.cwd(), "data", "sessions");

// userId 已过认证，但落盘路径仍然只信白名单字符——纵深防御不嫌多
function userSessionDir(userId: string): string {
  const dir = join(sessionsRoot, userId.replace(/[^a-zA-Z0-9_-]/g, "_"));
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 新用户建新会话；老用户打开目录里最新的会话文件继续聊。 */
function sessionManagerFor(userId: string): SessionManager {
  const dir = userSessionDir(userId);
  const latest = readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => ({ name, mtimeMs: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];

  return latest
    ? SessionManager.open(join(dir, latest.name))
    : SessionManager.create(process.cwd(), dir);
}

export async function initModelRuntime(): Promise<ModelRuntime> {
  const modelRuntime = await ModelRuntime.create();
  if ((await modelRuntime.getAvailable()).length === 0) {
    throw new Error("没有可用模型：请先配置 Provider 和 API Key");
  }
  return modelRuntime;
}

// 审批卡要推给 SSE：宿主在 server.ts 里注入通知函数，避免模块循环依赖
let approvalNotifier: (approval: PendingApproval) => void = () => {};
export function setApprovalNotifier(fn: (approval: PendingApproval) => void): void {
  approvalNotifier = fn;
}

function createUserSession(userId: string, modelRuntime: ModelRuntime): Promise<UserEntry> {
  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    extensionFactories: [
      createApprovalGate({ userId, onRequest: (a) => approvalNotifier(a) }),
    ],
    systemPromptOverride: () =>
      [
        `你是用户 ${userId} 的销售与工单助手。`,
        "查数字前必须先使用 query_sales；创建工单用 create_ticket。",
        "不能编造数据；查询没有结果就明确说明。",
      ].join("\n"),
    appendSystemPromptOverride: () => [],
  });

  return (async () => {
    await loader.reload();
    const provider = process.env.AGENT_PROVIDER;
    const modelId = process.env.AGENT_MODEL;
    const model =
      (provider && modelId ? modelRuntime.getModel(provider, modelId) : undefined)
      ?? (await modelRuntime.getAvailable())[0];
    if (!model) throw new Error("请先配置一个可用模型");

    const { session } = await createAgentSession({
      model,
      modelRuntime,
      resourceLoader: loader,
      customTools: [querySalesTool, createTicketToolFor(userId)],
      tools: ["query_sales", "create_ticket"],
      sessionManager: sessionManagerFor(userId), // 6.3：持久化替换 inMemory
    });

    const entry: UserEntry = { session, running: false };
    session.subscribe((event) => {
      if (event.type === "agent_start") entry.running = true;
      if (event.type === "agent_settled") entry.running = false;
    });
    return entry;
  })();
}

/** 懒创建 + 去重：同一用户的并发首请求不会建两份会话 */
export function getOrCreate(userId: string, modelRuntime: ModelRuntime): Promise<UserEntry> {
  let entry = registry.get(userId);
  if (!entry) {
    entry = createUserSession(userId, modelRuntime);
    registry.set(userId, entry);
  }
  return entry;
}

/** 停机流程用：等所有会话空闲后再 dispose。 */
export async function allEntries(): Promise<UserEntry[]> {
  return Promise.all([...registry.values()]);
}
