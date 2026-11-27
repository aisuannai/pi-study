//模拟多用户选择模型
import {
  createAgentSession,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";

import {
  DefaultResourceLoader,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";

import { users } from "../common/common.ts"

for(const user of users){
    //每个用户单独一个ModelRuntime，互不影响
    const modelRuntime = await ModelRuntime.create()
    const model = modelRuntime.getModel(user.provider_id, user.model_id)
    if(!model){
        throw new Error(`可用模型没有${user.model_name}`)
    }
    console.log(`用户${user.user_name} 选择了${user.model_name}模型`)
    
    const resourceLoader = new DefaultResourceLoader({
      cwd: process.cwd(),
      agentDir: getAgentDir(),
      systemPromptOverride: (base)=> [base, `当前用户:${user.user_prompt}`].filter(Boolean).join('\n'),
      appendSystemPromptOverride: () => [],
    });

    await resourceLoader.reload();

    const {session} = await createAgentSession({
        model,modelRuntime,resourceLoader
    })

    const unsubscribe = session.subscribe((event)=>{
        if(event.type==='message_update' && event.assistantMessageEvent.type==='text_delta'){
             process.stdout.write(event.assistantMessageEvent.delta);
        }
        if(event.type==='message_end' 
             && event.message.role==='assistant'
              && event.message.stopReason==='error'){
             console.log(event.message.errorMessage)
        }
    })

    try {
      await session.prompt("你知道我是谁吗");
      process.stdout.write("\n");
    } finally {
        unsubscribe();
        session.dispose();
    }
}