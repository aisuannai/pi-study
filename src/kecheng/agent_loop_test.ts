import {
  createAgentSession,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";

const modelRuntime =  await ModelRuntime.create();
//返回所有聊天模型，getAllAvailable会返回很多类型的模型
const choices = await modelRuntime.getAvailable();
const model = choices.find((item)=>item.id==='deepseek-v4.1-flash')?? choices[0]

// 第 04 课的规则：选不出模型就停下，不要带着 undefined 往走
if (!model) {
  throw new Error("没有可用模型：请先配置 Provider 和 API Key");
}

console.log(`选择$${model.name}模型`)


const {session} = await createAgentSession({
    model,modelRuntime,
})

let i = 0
//订阅
const unsubscribe = session.subscribe((event)=>{
   //这个事件监听器是同步循环，如果一个监听事件卡住，其他的监听事件也会停下排队，因此这里面不能处理如数据库等耗时的业务
   switch(event.type){
    case "agent_start":
      console.log("run 开始");
      break;

    case "turn_start":
      i++
      console.log(`turn ${i} 开始`);
      break;

    case "message_start":
      // 一条 assistant 消息 = 一次模型请求。
      // 一个 turn ≈ 一次模型请求 + 它请求调用的那些工具，所以正常情况下 turn 数 ≈ 模型请求数。
      // 但 system / user / toolResult 消息也会触发 message_start，它们不算模型请求。
      if (event.message.role === "assistant") {
        console.log(`发送请求`)
      }
      console.log(`message_start role=${event.message.role}`);
      break;

    case "message_update": {
      const inner = event.assistantMessageEvent;
      if (inner.type === "text_delta") {
        console.log(`ai回复内容:${inner.delta}`);
      } else if (inner.type === "thinking_delta") {
        console.log(`ai思考内容:${inner.delta}`)
      } else {
        console.log(`message_update类型:${inner.type}`)
      }
      break;
    }

    case "message_end": {
      const message = event.message;
      if (message.role === "assistant") {
        // usage 只在 assistant 消息上有，靠 role 收窄才能安全访问。
         console.log(
          `message_end assistant  stop=${message.stopReason} ` +
            `tokens=${message.usage.input}in/${message.usage.output}out`,
        );
      }
      break;
    }

    case "tool_execution_start":
     console.log(`工具开始 ${event.toolName} args=${JSON.stringify(event.args)}`);
      break;

    case "tool_execution_end": {
      console.log(
        `工具结束 ${event.toolName} 结果: ${event.isError ? "失败" : "成功"} ` +
          `result=${JSON.stringify(event.result)}`,
      );
      break;
    }

    case "turn_end":
      console.log(
        `turn ${i} 结束 助手消息=${event.message.role} 工具结果=${event.toolResults.length}`,
      );
      break;

    case "agent_end":
      console.log(`run 结束 willRetry=${event.willRetry}`);
      break;

    case "agent_settled":
      console.log(`已稳定 aborted=${event.aborted}（pi 不会再有后续动作）`);
      break;

    default:
      // 其他事件（重试、压缩、队列……）先只记类型。
      console.log(`其他事件 ${event.type}`);
   }
})

try {
   await session.prompt('我的电脑ip是多少？')
   process.stdout.write("\n");
} catch (error) {
   console.log(`异常：${JSON.stringify(error)}`)
} finally{
  unsubscribe();
  session.dispose();
}