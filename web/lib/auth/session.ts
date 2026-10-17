import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { authUsers, authSessions, brandProfiles } from "@/lib/db/schema";
import { SESSION_COOKIE, SESSION_SECONDS } from "./policy";
export function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export async function sessionForToken(token?: string) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const [row] = await db
    .select({
      userId: authUsers.id,
      email: authUsers.email,
      role: authUsers.role,
      brand: brandProfiles,
    })
    .from(authSessions)
    .innerJoin(authUsers, eq(authSessions.userId, authUsers.id))
    .innerJoin(brandProfiles, eq(authUsers.brandProfileId, brandProfiles.id))
    .where(
      and(
        eq(authSessions.tokenHash, tokenHash(token)),
        gt(authSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row || null;
}
export async function currentSession() {
  return sessionForToken((await cookies()).get(SESSION_COOKIE)?.value);
}
export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  await db
    .insert(authSessions)
    .values({
      tokenHash: tokenHash(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000),
    });
  return token;
}
export async function revokeSession(token?: string) {
  if (token)
    await db
      .delete(authSessions)
      .where(eq(authSessions.tokenHash, tokenHash(token)));
}
export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_SECONDS,
};
