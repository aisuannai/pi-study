# pi SDK 事件流笔记（1.6.1）

> 适用版本：`@earendil-works/pi-coding-agent` 1.6.1 / `pi-agent-core` 1.6.1 / `pi-ai` 1.6.1
> 结论都对照过 `node_modules` 里的 d.ts 与 `agent-loop.js`，文末有待核验的源码位置。
> 记录日期：2026-11-26

## 相关笔记

- [[stage1-events]] —— 一次真实运行的**带时间戳时序 + 体积实测**（基于 SDK 1.5.0 的 `traces/*.jsonl`）。
  想了解"实际跑起来长什么样、日志为什么这么大"看那份。
- 本文侧重：**事件类型/字段速查、stopReason 分支、订阅模板、本次踩坑表**，并已按 1.6.1 源码核对。
  两份的循环骨架一致，版本差异集中在字段细节上；有出入以本文的源码行号为准。

## 1. 四层心智模型

```
agent_start / agent_end            ← 一次完整任务（含自动重试、队列里的消息）
  turn_start / turn_end            ← 一次模型请求 + 它引发的工具执行
    message_start / message_end    ← 一条消息（user / assistant / toolResult / system）
      message_update               ← 只有 assistant 消息有，且只在 start~end 之间
```

记这四层就不会把"轮"和"消息"搞混：

- 有工具调用 → **至少两轮**，每轮一对 `turn_start`/`turn_end`；
- `message_update` 一定在 `message_start` 和 `message_end` 之间；
- `tool_execution_*` 在 assistant 的 `message_end` 之后、`turn_end` 之前。

## 2. 完整事件序列（一轮 thinking + 调工具 → 一轮回答）

对应 `await session.prompt("我的IP是多少")`：

```
agent_start

turn_start                      ← 第 1 轮 = 第 1 次模型请求
  message_start  role:system    ← 合成的"工具声明"消息（toolsAdded），工具集变化时才发
  message_end    role:system
  message_start  role:user      ← 传入的 prompt，成对出现，中间没有 update
  message_end    role:user
  message_start  role:assistant
    message_update  thinking_start / thinking_delta×N / thinking_end
    message_update  toolcall_start / toolcall_delta×N / toolcall_end
  message_end    role:assistant  stop=toolUse      ← 这轮不是最终回答，是"请求执行工具"
  tool_execution_start   bash { command: "ip addr" }
  tool_execution_update×N        ← 工具流式输出（可选）
  tool_execution_end     { result, isError, durationMs }
  message_start  role:toolResult ← 成对，没有 update
  message_end    role:toolResult
turn_end { message: assistant, toolResults: [...] }

turn_start                      ← 第 2 轮 = 第 2 次模型请求
  message_start  role:assistant
    message_update  text_start / text_delta×N / text_end
  message_end    role:assistant  stop=stop
turn_end { message: assistant, toolResults: [] }

agent_end { messages, willRetry }
agent_settled { aborted }       ← AgentSession 层收尾，真正的"不会再有后续了"
```

## 3. 事件字段与用途

| 事件 | 关键字段 | 用途 |
|---|---|---|
| `agent_start` | — | 任务开始 |
| `turn_start` | — | 即将发起一次模型请求 |
| `message_start` / `message_end` | `message` | 消息边界；`message.start/end` 成对出现 |
| `message_update` | `message`, `assistantMessageEvent` | 流式内容，见第 4 节 |
| `tool_execution_start` | `toolCallId`, `toolName`, `args` | 工具就要跑了 |
| `tool_execution_update` | `partialResult` | 工具流式输出（bash 等） |
| `tool_execution_end` | `result`, `isError`, `durationMs` | 工具跑完，**只有这里才知道成败和耗时** |
| `turn_end` | `message`, `toolResults` | 本轮结束，携带本轮工具结果 |
| `agent_end` | `messages`, `willRetry` | 低层 run 结束；`willRetry=true` 时后面还会继续 |
| `agent_settled` | `aborted` | 确认不会再有自动继续（这才是终态） |

## 4. `message_update` 里的子事件

一条 assistant 消息可以包含多种内容块，`contentIndex` 标识是第几块：

| 块 | 子事件 | 内容 |
|---|---|---|
| 思考 | `thinking_start` → `thinking_delta`×N → `thinking_end` | 推理文本 |
| 正文 | `text_start` → `text_delta`×N → `text_end` | 回复文本 |
| 工具调用 | `toolcall_start` → `toolcall_delta`×N → `toolcall_end` | **参数 JSON 的流式分片** |

要点：

- `toolcall_delta.delta` 是**半截 JSON**，单独 `JSON.parse()` 必失败。完整参数只在 `toolcall_end.toolCall.arguments`（已解析），或自行累积。
- 分片数量取决于 token 数：思考几句话 → 十几片；工具参数是一长串 JSON → 几十上百片，属正常。
- **块边界不能靠事件顺序判断**。实测日志里出现过 `toolcall_start` 早于 `thinking_end`（交错）。判断结构看 `contentIndex` 和 `partial`，不要假设 start/end 相邻。
- `text_end` 只是文本块结束，**不是**"AI 说完了"；同一消息里后面还可能跟 toolCall。

## 5. stopReason 决定下一步

| stopReason | 含义 | 后续 |
|---|---|---|
| `toolUse` | 请求执行工具 | 执行工具 → toolResult 入上下文 → 下一轮 |
| `stop` | 正常说完 | 本轮结束，检查 follow-up / 收尾 |
| `length` | 被 token 上限截断 | 所有 toolCall 直接判失败（不执行半截参数），然后收尾 |
| `error` / `aborted` | 出错或被取消 | 立即 `turn_end` → `agent_end`，不会有下一轮 |
| `deferred` / `pending` | 延迟响应 | 由 deferred 流程处理 |

"结束"的三个层次别混：

- 一条消息结束 → `message_end`
- 一轮结束 → `turn_end`
- 整个任务结束 → `agent_settled`（`agent_end` 之后还可能自动重试）

## 6. 订阅模板（正式渲染用）

```ts
const unsub = session.subscribe((event) => {
  switch (event.type) {
    case "message_update": {
      const e = event.assistantMessageEvent;
      if (e.type === "text_delta") process.stdout.write(e.delta);
      if (e.type === "toolcall_end")
        console.log(`\n[tool] ${e.toolCall.name}`, e.toolCall.arguments);
      return; // thinking_delta / toolcall_delta 默认忽略
    }
    case "tool_execution_start":
      console.log(`[run] ${event.toolName}`, event.args);
      return;
    case "tool_execution_end":
      console.log(`[done] ${event.toolName} error=${event.isError} ${event.durationMs ?? "?"}ms`);
      return;
    case "message_end":
      console.log(`[msg] stop=${event.message.stopReason}`);
      return;
    case "agent_settled":
      console.log(`[settled] aborted=${event.aborted}`);
      return;
  }
});

try {
  await session.prompt("我的电脑 IP 是多少");
} finally {
  unsub();
  session.dispose();
}
```

## 7. 本次踩过的 SDK 坑（速查）

| 现象 | 根因 | 修法 |
|---|---|---|
| `node src/hello.ts` 毫无输出、退出码 0 | `getAllAvailable()` 返回 Promise，`for...in` 遍历 Promise 得 0 次 | `await`；遍历数组用 `for...of` |
| `find` 总是找不到 | 箭头函数带 `{}` 却漏了 `return` | 去掉大括号，或显式 `return` |
| 选到的是 Claude Haiku 而不是 deepseek | 上一条导致 `find` 返回 `undefined`，`?? choices[0]` 静默兜底 | 找不到就抛错，别静默回退 |
| TS2322 `AnyModel` 不能赋给 `Model<any>` | `getAllAvailable()` 含图片/分类器模型；`createAgentSession` 要 chat 模型 | 用 `getAvailable()` 或 `getAvailableOfType("chat")` |
| TS2561 `modelRunTime` 不存在 | 选项名是 `modelRuntime`（小写 t） | `{ model, modelRuntime }` |
| 脚本什么都不输出 | 没 `await session.prompt(...)`，也没取结果 | `const { session } = await createAgentSession(...)`，再 `await session.prompt()` |
| `const x = await session.prompt()` 没内容 | `prompt()` 返回 `Promise<void>` | 文本在 `session.getLastAssistantText()` 或 `text_delta` 里 |
| 以为 `subscribe()` 返回 void | 返回的是注销函数 `() => void` | `const unsub = session.subscribe(fn); unsub()` |

类型参考：

```ts
getAllAvailable(...): Promise<readonly AnyModel[]>   // 含 chat/image/classifier
getAvailable(...):    Promise<readonly Model<Api>[]> // 只有 chat
createAgentSession(options?: { model?: Model<any>; modelRuntime?: ModelRuntime; ... }): Promise<CreateAgentSessionResult>
session.subscribe(listener): () => void              // 返回注销函数
session.prompt(text, options?): Promise<void>        // 结果不在返回值里
```

## 8. 关于"运行多次会留下什么"

单次 `node xxx.ts` 结束时，进程退出、OS 回收内存/句柄/监听器，所以加不加清理**看不出差别**。真正的差别在：

- **跨进程会累积**：默认 `SessionManager` 持久化，每 `createAgentSession()` 在 `~/.pi/agent/sessions/<cwd 编码>/` 落一个 JSONL；pi 无自动清理（实测本项目目录 5 个文件 / 132K，全部来自同一天的几次运行）。`dispose()` 不会删它们。
- **同进程内**：不 `unsubscribe` 会累积监听器/闭包，重复订阅会让回调执行多次。
- `dispose()` 实际做的事：abort 重试/压缩/分支摘要/bash、`agent.abort()`、扩展 ctx 失效、断开 agent、清空监听器、取消 cacheWarmer、`cleanupSessionResources(sessionId)`。
- 不想落盘：`sessionManager: SessionManager.inMemory()`。

## 9. 源码位置（1.6.1，待核验时按此查）

- 事件联合类型：`pi-agent-core/dist/types.d.ts:461`（`AgentEvent`）
- 流式子事件：`pi-ai/dist/types.d.ts:600`（`AssistantMessageEvent`）
- 主循环：`pi-agent-core/dist/agent-loop.js`
  - `agent_start` / 首个 `turn_start`：55-56
  - 工具声明合成消息：122-123（`declareToolChanges`）
  - `turn_end`：156、185；`agent_end`：157、187、212
  - toolResult 消息：672-673
- 会话层：`pi-coding-agent/dist/core/agent-session.d.ts:401`（`subscribe`）、`agent-session.js:1074`（`dispose`）
- 模型 API：`pi-coding-agent/dist/core/model-runtime.d.ts:76/78`
- SDK 选项：`pi-coding-agent/dist/core/sdk.d.ts:18`
