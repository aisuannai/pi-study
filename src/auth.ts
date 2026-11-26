import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export type AuthUser = {
  userId: string;
  tenantId: string;
};

export class AuthError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// fail-closed：没配密钥就拒绝启动，绝不降级成匿名模式
// （?? "" 是给类型一个非 undefined 的承诺，空值由下一行抛错拦下）
const secret = process.env.AUTH_SECRET ?? "";
if (!secret) {
  throw new Error("必须通过环境变量注入 AUTH_SECRET");
}

function sign(payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** 签发令牌：本地测试或你的登录接口用。生产请换 JWT 库 + IdP。 */
export function issueToken(user: AuthUser, ttlSeconds = 3600): string {
  const payload = JSON.stringify({
    ...user,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  });
  const payloadB64 = Buffer.from(payload).toString("base64url");
  return `${payloadB64}.${sign(payloadB64)}`;
}

/** 每个请求都过这里：验证失败一律 401，不存在“验不过就当访客”。 */
export function authenticate(req: IncomingMessage): AuthUser {
  const header = req.headers["authorization"];
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    throw new AuthError("missing bearer token", 401);
  }

  const [payloadB64, signature] = header.slice("Bearer ".length).split(".");
  if (!payloadB64 || !signature) throw new AuthError("malformed token", 401);

  // timingSafeEqual 防时序攻击：比较签名不用 ===
  const expected = Buffer.from(sign(payloadB64));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new AuthError("bad signature", 401);
  }

  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as {
    userId?: string;
    tenantId?: string;
    exp?: number;
  };
  const expired = typeof payload.exp !== "number" || payload.exp * 1000 < Date.now();
  if (!payload.userId || expired) {
    throw new AuthError("token expired or invalid", 401);
  }
  return { userId: payload.userId, tenantId: payload.tenantId ?? "default" };
}
