/**
 * 巡视任务工具集（第 06 课练习 · 全部为模拟数据）
 *
 * 三个工具只演示“工具契约怎么写”：参数 schema、结果形状、取消与错误语义。
 * 真实生产环境的权限校验、真实调度、报告落库都必须接业务系统，
 * 不能照抄这里的模拟逻辑。
 */
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";

interface InspectionTask {
  id: string
  name: string
  area: string
  progress: number
}

// 模块级内存存储：进程内模拟，重启即清空（真实实现应接数据库或调度系统）
const tasks = new Map<string, InspectionTask>()
let nextTaskId = 1

export const runInspectionTask = defineTool({
  name: "run_inspection_task",
  label: "执行巡视任务",
  description: "创建一个模拟巡视任务，立即返回任务 id、名称和初始状态。不会真正调度人员或设备。",
  parameters: Type.Object({
    task_name: Type.String({ description: "任务名称，例如：三号变电站夜间巡视" }),
    area: Type.Optional(Type.String({ description: "巡视区域；不传则为“未指定”" })),
  }),
  async execute(_toolCallId, params, signal) {
    if (signal?.aborted) {
      return {
        content: [{ type: "text", text: "任务创建已取消。" }],
        details: { taskId: "", taskName: params.task_name },
        isError: true,
      }
    }
    const task: InspectionTask = {
      id: `task_${nextTaskId++}`,
      name: params.task_name,
      area: params.area ?? "未指定",
      progress: 0,
    }
    tasks.set(task.id, task)
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          taskId: task.id,
          taskName: task.name,
          area: task.area,
          status: "created",
        }, null, 2),
      }],
      details: { taskId: task.id, taskName: task.name },
    }
  },
})

export const getInspectionTask = defineTool({
  name: "get_inspection_task",
  label: "查看巡视任务详情",
  description: "按任务 id 查询模拟巡视任务的详情与进度。每查询一次，模拟进度增加 25%。",
  parameters: Type.Object({
    task_id: Type.String({ description: "run_inspection_task 返回的任务 id，例如 task_1" }),
  }),
  async execute(_toolCallId, params) {
    const task = tasks.get(params.task_id)
    if (!task) {
      // 查无数据是正常业务结果，不是 isError
      return {
        content: [{ type: "text", text: `没有找到任务：${params.task_id}` }],
        details: { taskId: params.task_id, found: false, progress: 0 },
      }
    }
    task.progress = Math.min(100, task.progress + 25)
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          taskId: task.id,
          taskName: task.name,
          area: task.area,
          progress: `${task.progress}%`,
        }, null, 2),
      }],
      details: { taskId: task.id, found: true, progress: task.progress },
    }
  },
})

export const generateInspectionReport = defineTool({
  name: "generate_inspection_report",
  label: "生成巡视任务报告",
  description: "为指定任务生成一份模拟巡视报告（默认 Markdown），包含任务信息、进度与结论占位。",
  parameters: Type.Object({
    task_id: Type.String({ description: "要生成报告的任务 id" }),
    format: Type.Optional(Type.String({ description: "输出格式：markdown 或 text，默认 markdown" })),
  }),
  async execute(_toolCallId, params) {
    const format = params.format === "text" ? "text" : "markdown"
    const task = tasks.get(params.task_id)
    if (!task) {
      return {
        content: [{ type: "text", text: `无法生成报告：没有找到任务 ${params.task_id}` }],
        details: { taskId: params.task_id, found: false, progress: 0, format },
      }
    }
    const lines = [
      format === "markdown" ? `# 巡视报告 · ${task.name}` : `巡视报告 · ${task.name}`,
      "",
      `- 任务 ID：${task.id}`,
      `- 区域：${task.area}`,
      `- 进度：${task.progress}%`,
      `- 结论：${task.progress >= 100 ? "巡视完成，未发现异常（模拟）" : "巡视进行中，结论待补充（模拟）"}`,
    ]
    return {
      content: [{ type: "text", text: lines.join("\n") }],
      details: { taskId: task.id, found: true, progress: task.progress, format },
    }
  },
})
