import { randomUUID } from "node:crypto";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

export type PendingApproval = {
  id: string;
  userId: string;
  toolName: string;
  argsSummary: string;
  resolve: (approved: boolean) => void;
};

const pending = new Map<string, PendingApproval>();

/** 工厂返回的扩展只挂在“这个用户”的会话上，所以 userId 用闭包注入。 */
export function createApprovalGate(options: {
  userId: string;
  timeoutMs?: number;
  onRequest?: (approval: PendingApproval) => void;
}): ExtensionFactory {
  const timeoutMs = options.timeoutMs ?? 120_000;

  return (pi) => {
    pi.on("tool_call", (event) => {
      // 只拦写操作；只读工具直接放行
      if (event.toolName !== "create_ticket") return;

      return new Promise((resolve) => {
        const finish = (approved: boolean) => {
          clearTimeout(timer);
          pending.delete(approval.id);
          resolve(
            approved
              ? undefined // 放行：继续执行 execute
              : { block: true, reason: "审批人拒绝了这次操作" },
          );
        };

        const approval: PendingApproval = {
          id: randomUUID(),
          userId: options.userId,
          toolName: event.toolName,
          argsSummary: JSON.stringify(event.input),
          resolve: finish,
        };

        const timer = setTimeout(() => finish(false), timeoutMs); // 超时 = 拒绝
        pending.set(approval.id, approval);
        options.onRequest?.(approval); // 宿主把审批卡推到 SSE
      });
    });
  };
}

/** 审批接口回调：只有本人能批本人的操作。 */
export function resolveApproval(id: string, userId: string, approved: boolean): boolean {
  const approval = pending.get(id);
  if (!approval || approval.userId !== userId) return false;
  approval.resolve(approved);
  return true;
}
