/**
 * 版本漂移防御：教程断言过的 SDK 符号，逐个核对存在性。
 * 用法：npm run verify:symbols
 *
 * 升级 pi-coding-agent 版本后先跑它：每一行对应教程里讲到的一个 API，
 * 任何 ✗ 都意味着对应章节需要重写。本脚本只验证“符号存在”；
 * 语义回归要靠评测集（高级篇 H.4），类型错误由 `npx tsc --noEmit` 兜底。
 */

import * as pi from "@earendil-works/pi-coding-agent";

type Check = { name: string; ok: boolean; where: string };

const checks: Check[] = [];

function check(name: string, value: unknown, where: string): void {
  checks.push({ name, ok: value !== undefined && value !== null, where });
}

function hasMethod(cls: unknown, method: string): boolean {
  const proto = (cls as { prototype?: unknown } | undefined)?.prototype;
  if (typeof proto !== "object" || proto === null) return false;
  return typeof (proto as Record<string, unknown>)[method] === "function";
}

// —— SDK 导出（各册引用过的入口）——
check("createAgentSession", pi.createAgentSession, "第 02 课");
check("ModelRuntime", pi.ModelRuntime, "第 04 课");
check("SessionManager.inMemory", pi.SessionManager?.inMemory, "第 02 课");
check("SessionManager.create", pi.SessionManager?.create, "生产篇 6.3");
check("SessionManager.open", pi.SessionManager?.open, "生产篇 6.3");
check("DefaultResourceLoader", pi.DefaultResourceLoader, "第 05 课");
check("getAgentDir", pi.getAgentDir, "第 05 课");
check("defineTool", pi.defineTool, "第 06 课");
check("SettingsManager.create", pi.SettingsManager?.create, "SDK 深入篇 04");
check("AgentSessionRuntime", pi.AgentSessionRuntime, "第 08 课 / 高级篇 I.2");
check("RpcClient", pi.RpcClient, "进阶篇 D.3");
check("createMcpExtension", pi.createMcpExtension, "SDK 深入篇 04");
check("createCodemodeExtension", pi.createCodemodeExtension, "SDK 深入篇 04");
check("createToolSearchExtension", pi.createToolSearchExtension, "SDK 深入篇 04");
check("createSyntheticSourceInfo", pi.createSyntheticSourceInfo, "SDK 深入篇 03");
check("isToolCallEventType", pi.isToolCallEventType, "进阶篇 B.6");

// —— AgentSession 实例方法（在原型上核对，不真正实例化）——
for (const method of [
  "subscribe",
  "prompt",
  "steer",
  "followUp",
  "abort",
  "waitForIdle",
  "dispose",
  "getLastAssistantText",
  "bindExtensions",
]) {
  check(`AgentSession#${method}`, hasMethod(pi.AgentSession, method), "第 02/09 课、生产篇 6.6");
}

// —— ModelRuntime 实例方法 ——
for (const method of [
  "getAvailable",
  "getModel",
  "setRuntimeApiKey",
  "removeRuntimeApiKey",
  "getProviderAuthStatus",
  "settleCredentialWrites",
  "registerVirtualModel",
  "streamSimple",
]) {
  check(`ModelRuntime#${method}`, hasMethod(pi.ModelRuntime, method), "第 04 课 / 高级篇 I.3");
}

const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? "✓" : "✗"} ${c.name}${c.ok ? "" : `  —— ${c.where}`}`);
}
console.log(
  `\n${checks.length - failed.length}/${checks.length} 个符号存在` +
    `（仅查存在性；语义回归见高级篇 H.4 评测集）`,
);
if (failed.length > 0) process.exitCode = 1;
