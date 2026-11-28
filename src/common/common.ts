/**
 * 多用户空间工厂（第 05 课配套实现）
 *
 * 模型分层：User → Workspace[] → Session
 * - 一个 session 只绑一个 cwd（SDK 单值）；多项目 = 多个 workspace，建会话时选一个
 * - agentDir 是用户级配置柜；项目级配置放 <workspace>/.pi/
 * - sessions 根独立于 workspace、按 workspace 分区（对齐 SessionManager 默认 --cwd-- 布局）
 *
 * 目录职责（data/users/<user_code>/）：
 *   agent/       用户级：skills、扩展、settings（空目录 = 干净空间）
 *   workspace/   默认工作区：文件工具的 cwd、项目 AGENTS.md 与 .pi/
 *   sessions/    会话 JSONL（运行时产物，不提交）
 *
 * 推进到部署的路径：
 *   1. 单 workspace 演练（当前）：本文件
 *   2. 多 workspace：抽 Workspace 类型，sessions/<projectKey> 分区
 *   3. 性能：按用户缓存 loader / ModelRuntime，别每请求重建
 *   4. 凭据：共享 ModelRuntime + setRuntimeApiKey 覆盖，或每用户 runtime + 显式 authPath
 *   5. 数据：会话保留/清理/备份策略；data/ 不进 git
 *   6. 隔离：对外用户用容器/进程（独立 HOME、PI_CODING_AGENT_DIR、网络与文件边界）；
 *      cwd 不是安全边界，绝对路径仍可达
 *   7. 服务化：HTTP/SSE + 鉴权 + 限流 + 审计（第 09 课、生产篇）
 */

import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  generateInspectionReport,
  getInspectionTask,
  runInspectionTask,
} from "../tools/inspection.ts";

/** 角色 = 业务身份 + 该身份可用的工具集合（数据描述，不直接等于“已暴露给模型”） */
export interface Role {
  role_code: string
  role_name: string
  tools: ToolDefinition[]
}

export const inspectorRole: Role = {
  role_code: "inspector",
  role_name: "巡视员",
  tools: [runInspectionTask, getInspectionTask, generateInspectionReport],
}

export const adminRole: Role = {
  role_code: "admin",
  role_name: "管理员",
  tools: [getInspectionTask, generateInspectionReport],
}

export const shenheRole: Role = {
  role_code: "shenhe",
  role_name: "审核员",
  tools: [generateInspectionReport],
}

export interface UserConfig {
  user_name: string
  user_code: string
  model_id: string
  model_name: string
  provider_id: string
  user_prompt: string
  api_key?: string
  role: Role
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
  role: Role
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
    // 角色是配置数据；工具要真正可用，还要在 createAgentSession 里传 customTools / tools
    this.role = cfg.role
    // 同一用户的三个目录平级，统一挂在 root 下，路径只在这里推导一次
    const root = join("data/users", cfg.user_code)
    // 默认工作区。cwd 在 SDK 里是单值：一个 session 绑定一个 workspace；
    // 多项目时在“建会话”处选一个，而不是把这里改成数组。
    this.workspace = cfg.workspace ?? join(root, "workspace")
    // 用户级配置柜，所有 workspace 共享；项目级配置放各 workspace 的 .pi/ 下。
    this.agent_dir = cfg.agent_dir ?? join(root, "agent")
    // 会话根独立于 workspace，按 workspace 分区（对齐 pi 默认的 --cwd-- 布局）。
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
    role: inspectorRole,
  }),
  new User({
    user_name: '李四',
    user_code: 'lisi',
    model_id: 'hy4-flash-free',
    model_name: '企鹅4',
    provider_id: 'opencode-go',
    user_prompt: '当前用户信息:我是李四，住在山西',
    api_key: '123456789',
    role: adminRole,
  }),
  new User({
    user_name: '王五',
    user_code: 'wangwu',
    model_id: 'hy4-flash-free',
    model_name: '企鹅4',
    provider_id: 'opencode-go',
    user_prompt: '当前用户信息:王五，住在青岛',
    role: shenheRole,
  }),
]

export async function createUserSpace(user: User) {
  const workspace = user.workspace // 用户的 cwd
  const agentDir = user.agent_dir  // 用户的 agentDir
  const sessions = user.sessions_dir //用户的会话空间
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
    systemPrompt: ['回答问题时要实事求是，不要编造答案',user.user_prompt].join('\n'), //自定义系统提示词
  });
  await loader.reload();
  const contextFiles = loader.getAgentsFiles().agentsFiles
  const loadedSkills = loader.getSkills().skills
  console.log(
    [
      `用户：${user.user_name}`,
      `角色：${user.role.role_name}（${user.role.tools.map((tool) => tool.name).join("、")}）`,
      `工作空间：${workspace}`,
      `配置空间：${agentDir}`,
      `AGENTS.md：${contextFiles.length > 0 ? contextFiles.map((file) => file.path).join("、") : "（无）"}`,
      `skills：${loadedSkills.length > 0 ? loadedSkills.map((skill) => skill.name).join("、") : "（无）"}`,
    ].join("\n"),
  )
  return { 
            workspace, 
            loader, 
            //创建user的session空间,create()每次都创建新的会话; continueRecent() 是从最新的一次开始
            sessionManager: SessionManager.continueRecent(workspace, sessions) 
         };
}
