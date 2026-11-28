import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  users,
  createUserSpace,
} from '../common/common.ts'

import {
  createAgentSession,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";

/** 输入 user_code 选一个用户；也支持输入列表里的序号 */
async function pickUserCode(ask: (question: string) => Promise<string | null>): Promise<string | null> {
  // 命令行参数优先：node src/kecheng/dynamic-user-tool.ts zhangsan
  const fromArgv = process.argv[2]?.trim()
  if (fromArgv) return fromArgv

  console.log("可用用户：")
  for (const [index, item] of users.entries()) {
    console.log(`  ${index + 1}. ${item.user_code}（${item.user_name} / ${item.role.role_name}）`)
  }
  return ask("输入 user_code 或序号：")
}

function findUser(inputCode: string) {
  const index = Number.parseInt(inputCode, 10)
  const byIndex = Number.isInteger(index) ? users[index - 1] : undefined
  return byIndex ?? users.find((item) => item.user_code === inputCode)
}

// 一个 readline 实例贯穿整个对话：选用户和后续聊天共用同一条输入流
const rl = createInterface({ input: stdin, output: stdout })

// stdin 关闭（Ctrl+D / 管道结束）时 question 会抛错，统一转成 null，让调用方干净退出
const ask = async (question: string): Promise<string | null> => {
  try {
    return (await rl.question(question)).trim()
  } catch {
    return null
  }
}

try {
  const userCode = await pickUserCode(ask)
  if (!userCode) {
    throw new Error("没有选择用户：输入流已关闭")
  }
  const user = findUser(userCode)
  if (!user) {
    throw new Error(`用户编号:${userCode}不存在`)
  }

  // 每个用户单独一个 ModelRuntime，互不影响
  const modelRuntime = await ModelRuntime.create()
  const model = modelRuntime.getModel(user.provider_id, user.model_id)
  if (!model) {
    throw new Error(`可用模型没有${user.model_name}`)
  }
  console.log(`用户${user.user_name} 选择了${user.model_name}模型`)

  // 获取用户的资源加载器
  const user_space = await createUserSpace(user)

  const { session } = await createAgentSession({
    model,
    modelRuntime,
    resourceLoader: user_space.loader,
    cwd: user_space.workspace,
    // 每个用户独立的会话文件目录
    sessionManager: user_space.sessionManager,
    customTools: user.role.tools, // 定义有哪些工具
    tools: user.role.tools.map((item) => item.name), // 能使用哪些工具
  })

  const unsubscribe = session.subscribe((event) => {
    try{
        if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
          process.stdout.write(event.assistantMessageEvent.delta)
        }
        if (event.type === 'tool_execution_start'){
        console.log(`工具开始执行 工具名:${event.toolName},参数:${JSON.stringify(event.args)}`)
        }
        if (event.type === 'tool_execution_end'){
        console.log(`工具执行结果 工具名:${event.toolName},结果:${JSON.stringify(event.result)},执行情况:${event.isError?'失败':'成功'},耗时:${event.durationMs}`)
        }
        if (
        event.type === 'message_end'
        && event.message.role === 'assistant'
        && event.message.stopReason === 'error'
        ) {
           console.log(event.message.errorMessage)
        }     
    } catch(e){
        console.error(e)
    }
  })

  try {
    console.log("\n开始对话：输入 /quit 退出，/tools 查看当前角色的工具。")

    // 同一个 session 连续 prompt = 多轮对话；历史由 session 自己维护
    while (true) {
      const human_input = await ask("你> ")
      if (human_input === null) {
        console.log("\n输入结束，退出对话。")
        break
      }
      if (!human_input) continue

      if (human_input === "/quit") break

      if (human_input === "/tools") {
        console.log(
          user.role.tools
            .map((tool) => `- ${tool.name}：${tool.description}`)
            .join("\n"),
        )
        continue
      }

      await session.prompt(human_input)
      process.stdout.write("\n")
    }
  } finally {
    unsubscribe()
    session.dispose()
  }
} finally {
  rl.close()
}
