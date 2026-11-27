# AGENTS.md · pi-agent-learning

pi-coding-agent（`@earendil-works/pi-coding-agent`，**钉死 1.6.1**）的学习仓库：`ziliao/` 是教程网站，`src/` 是课程练习。不是应用，没有构建产物和测试套件。

## 学习目标与协作方式（所有工作的前提）

- 终极目标：**以 pi agent 为底座开发自定义 Agent**。用户自己写的代码会很少，但必须弄懂运行机制；所以“能用”从来不是完成标准，“讲得清机制”才是。
- `ziliao/` 教程**不允许停留在浅层的 API 用法**：每个机制要讲清“谁、在什么时机、调用什么、数据怎么流”，给源码锚点（文件 + 符号名，标注版本），关键结论配可复现的实验/对照输出。
- 给用户写代码时：每次改动附带机制解释——这段代码踩在 SDK 的哪条路径上、为什么这样写、有什么替代方案。用户要能看懂并验收 AI 写的代码。
- 用户问“为什么”时，对着 `node_modules` 里的源码（d.ts / js）核实后回答，不凭记忆；源码与教程冲突时，以源码为准并顺手修正教程。

## 命令

- `npx tsc --noEmit` —— 唯一的类型检查；没有 build（`noEmit`），没有 lint。
- `npm run verify:symbols` —— 核对教程引用过的 SDK 符号是否仍存在（33 项）。**升级 pi SDK 后必跑**：任何 ✗ 对应的教程章节需要重写。
- `npm test` 是占位符，会报错退出，不要用它当验证手段。
- 运行练习：`node src/kecheng/hello.ts`（Node ≥ 22.19 直接跑 `.ts`，类型擦除模式）。

## 语言/工具链约定（与默认不同的部分）

- ESM + `moduleResolution: NodeNext`：**相对导入必须带 `.ts` 扩展名**（`import ... from "./common.ts"`），目录导入不解析。
- `erasableSyntaxOnly`：不能用 enum / namespace / 构造函数参数属性；`verbatimModuleSyntax`：类型导入必须写 `import type`。
- `typebox` 与 SDK 钉同一版本（1.3.27），升级一个必须同步另一个，否则会装出两份。

## 运行练习的副作用（动手前先想）

- 练习脚本会**真实调用模型**，凭据来自 `~/.pi/agent/auth.json`，产生真实 API 费用；不要随手跑。
- 默认 `SessionManager` 会把会话 JSONL 落到 `~/.pi/agent/sessions/<cwd编码>/` 并持续累积；新练习默认写 `SessionManager.inMemory()`。
- `src/common/common.ts` 的 `createUserSpace()` 会在 `data/users/<user_code>/{workspace,agent,sessions}` 建目录；`data/` 是运行产物，**不要提交**（尚未加进 .gitignore）。
- `~/.pi/agent/` 是宿主机级 pi 配置（auth.json=凭据、skills、npm 扩展），不属于本仓库；不要读取/打印 auth.json 内容。

## 目录职责

- `ziliao/*.html` —— 每页自包含（内联 CSS/JS，无打包器），**各页重复复制同一套 CSS**：改一处样式不会传播到其他页。
  验证方式：在 `ziliao/` 起静态服务（如 `python3 -m http.server`）+ 浏览器检查；`index.html` 有 JS 驱动的交互组件（第 03 课事件流播放器）。
- `src/kecheng/` —— 按课的练习；`src/common/common.ts` —— 共享的 users 配置与 `createUserSpace()` 工厂；`src/tools/` —— 第 06 课的工具；`src/*.ts`（server.ts 等）—— 第 09 课 Web 示例。
- `notes/` —— 学习笔记（事件时序等），教程内容部分引用它们。
- 教程正文引用了 SDK 源码文件与行号（`node_modules` 里的 d.ts/js）。**改教程断言前先对照 node_modules 源码**，行号随版本漂移。

## 其他

- 提交信息用中文；无 CI、无分支/发布流程约定。
- git 常态有大量未跟踪的练习文件，提交前与用户确认范围。
