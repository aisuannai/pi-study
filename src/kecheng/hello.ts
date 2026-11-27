import {
  createAgentSession,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";

const modelRuntime =  await ModelRuntime.create();
//返回所有聊天模型，getAllAvailable会返回很多类型的模型
const choices = await modelRuntime.getAvailable();
//const model = choices.find((item)=>item.id==='deepseek-v4.1-flash')?? choices[0]

for(const model of choices){
    console.log(`模型名称:${model.name} 模型id:${model.id}`)
}