import{
    users, 
    createUserSpace
} from '../common/common.ts'

import {
  createAgentSession,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";


//模拟多用户多空间,未来的目标做一个可以类似grokbot的云agent
for(const user of users){
    //每个用户单独一个ModelRuntime，互不影响
    const modelRuntime = await ModelRuntime.create()
    const model = modelRuntime.getModel(user.provider_id, user.model_id)
    if(!model){
        throw new Error(`可用模型没有${user.model_name}`)
    }
    console.log(`用户${user.user_name} 选择了${user.model_name}模型`)
    
    //获取用户的资源加载器
    const user_space =  await createUserSpace(user)

    const {session} = await createAgentSession({
        model,
        modelRuntime,
        resourceLoader: user_space.loader,
        //资源加载器都写了cwd,为什么这里还需要写一遍
        cwd: user_space.workspace,
        //自定义会会话空间
        sessionManager: user_space.sessionManager
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