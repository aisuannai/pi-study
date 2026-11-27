import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

export interface UserConfig {
  user_name: string
  user_code: string
  model_id: string
  model_name: string
  provider_id: string
  user_prompt: string
  api_key?: string
  workspace?: string
  agent_dir?: string
  sessions_dir?: string
}

export class User {
  user_name: string
  user_code: string
  model_id: string
  model_name: string
  provider_id: string
  user_prompt: string
  api_key?: string
  workspace: string
  agent_dir: string
  sessions_dir: string

  constructor(cfg: UserConfig) {
    this.user_name = cfg.user_name
    this.user_code = cfg.user_code
    this.model_id = cfg.model_id
    this.model_name = cfg.model_name
    this.provider_id = cfg.provider_id
    this.user_prompt = cfg.user_prompt
    this.api_key = cfg.api_key
    // 目录统一在 root 下推导：workspace / agent / sessions 平级
    const root = join("data/users", cfg.user_code)
    this.workspace = cfg.workspace ?? join(root, "workspace")
    this.agent_dir = cfg.agent_dir ?? join(root, "agent")
    this.sessions_dir = cfg.sessions_dir ?? join(root, "sessions")
  }
}

export const users: User[] = [
  new User({
    user_name: '张三',
    user_code: 'zhangsan',
    model_id: 'deepseek-v4.1-flash',
    model_name: '鲸鱼4',
    provider_id: 'opencode-go',
    user_prompt: '当前用户信息:我是张三，住在河北',
  }),
  new User({
    user_name: '李四',
    user_code: 'lisi',
    model_id: 'hy4-flash-free',
    model_name: '企鹅4',
    provider_id: 'opencode-go',
    user_prompt: '当前用户信息:我是李四，住在山西',
    api_key: '123456789',
  }),
  new User({
    user_name: '王五',
    user_code: 'wangwu',
    model_id: 'hy4-flash-free',
    model_name: '企鹅4',
    provider_id: 'opencode-go',
    user_prompt: '当前用户信息:王五，住在青岛',
  }),
]

export async function createUserSpace(user: User) {
  const workspace = user.workspace // 用户的 cwd
  const agentDir = user.agent_dir  // 用户的 agentDir
  const sessions = user.sessions_dir
  await mkdir(workspace, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await mkdir(sessions, { recursive: true });

  const loader = new DefaultResourceLoader({
    cwd: workspace, //工作空间
    agentDir,      //配置空间
    settingsManager: SettingsManager.inMemory(),
    noExtensions: true, //关闭插件
    noSkills: true,     //关闭skills
    noContextFiles: true, //关闭自动加载AGENTS.md(不关会把pi的AGENTS给加载进来)
    systemPrompt: user.user_prompt, //自定义系统提示词
  });
  await loader.reload();
  const contextFiles = loader.getAgentsFiles().agentsFiles
  const loadedSkills = loader.getSkills().skills
  console.log(
    [
      `用户：${user.user_name}`,
      `工作空间：${workspace}`,
      `配置空间：${agentDir}`,
      `AGENTS.md：${contextFiles.length > 0 ? contextFiles.map((file) => file.path).join("、") : "（无）"}`,
      `skills：${loadedSkills.length > 0 ? loadedSkills.map((skill) => skill.name).join("、") : "（无）"}`,
    ].join("\n"),
  )
  return { 
            workspace, 
            loader, 
            sessionManager: SessionManager.create(workspace, sessions) //创建user的session空间
         };
}
