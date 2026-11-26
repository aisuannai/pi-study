import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";

const tickets: Array<{ id: string; userId: string; title: string; createdAt: string }> = [];

export function listTicketsFor(userId: string) {
  // 行级隔离：数据在同一张“表”里，谁登录就只能看见谁的
  return tickets.filter((t) => t.userId === userId);
}

export function createTicketToolFor(userId: string) {
  return defineTool({
    name: "create_ticket",
    label: "创建工单",
    description: "为当前登录用户创建一条工单。创建前用户会在前端确认。",
    parameters: Type.Object({
      title: Type.String({ description: "工单标题，10 字以内", minLength: 1, maxLength: 10 }),
    }),
    async execute(_toolCallId, params) {
      // 教学用内存表；生产里这里是 INSERT INTO tickets（数据库外键再兜一层）
      const ticket = {
        id: randomUUID(),
        userId, // 来自工厂闭包 = 认证上下文，不是模型说了算
        title: params.title,
        createdAt: new Date().toISOString(),
      };
      tickets.push(ticket);
      return {
        content: [{ type: "text", text: `工单已创建，编号 ${ticket.id.slice(0, 8)}` }],
        details: { ticketId: ticket.id },
      };
    },
  });
}
