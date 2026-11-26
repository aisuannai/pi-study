//模拟多用户选择模型
import {
  createAgentSession,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";

const users=[
    {
       user_name:'张三',
       model_id:'deepseek-v4.1-flash',
       model_name:'鲸鱼4'
    },
    {
       user_name:'李四',
       model_id:'hy4-flash-free',
       model_name:'企鹅4'
    },
]

const modelRuntime = await ModelRuntime.create()
const choices = await modelRuntime.getAvailable()
for(const user of users){
    const model = choices.find((item)=>item.id === user.model_id)
    if(!model){
        new Error(`可用模型没有${user.user_name}`)
    }
    console.log(`用户${user.user_name} 选择了${user.model_name}模型`)
    const {session} = await createAgentSession({
        model,modelRuntime
    })

    const unsubscribe = session.subscribe((event)=>{
        if(event.type==='message_update' && event.assistantMessageEvent.type==='text_delta'){
             process.stdout.write(event.assistantMessageEvent.delta);
        }
    })

    try {
      await session.prompt("你使用的是什么模型");
      process.stdout.write("\n");
    } finally {
        unsubscribe();
        session.dispose();
    }
}
