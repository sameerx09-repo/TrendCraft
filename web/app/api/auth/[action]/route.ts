import { NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { authUsers, authBootstrap, brandProfiles } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  credentials,
  brandDetails,
  sameOrigin,
  SESSION_COOKIE,
} from "@/lib/auth/policy";
import {
  createSession,
  currentSession,
  revokeSession,
  tokenHash,
  sessionCookieOptions,
} from "@/lib/auth/session";

async function throttle(key: string, limit: number) {
  const rows = await db.execute(
    sql`INSERT INTO auth_attempts(key,count,expires_at) VALUES(${tokenHash(key)},1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN auth_attempts.expires_at<now() THEN 1 ELSE auth_attempts.count+1 END,expires_at=CASE WHEN auth_attempts.expires_at<now() THEN now()+interval '15 minutes' ELSE auth_attempts.expires_at END RETURNING count`,
  );
  return Number(rows[0].count) <= limit;
}
function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}
async function signedIn(userId: string) {
  const token = await createSession(userId);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return response;
}
export async function GET(
  _request: Request,
  context: { params: Promise<{ action: string }> },
) {
  if ((await context.params).action !== "session")
    return fail("Not found.", 404);
  const session = await currentSession();
  return session
    ? NextResponse.json(
        {
          email: session.email,
          role: session.role,
          brand: {
            id: session.brand.id,
            name: session.brand.name,
            domain: session.brand.domain,
          },
        },
        { headers: { "Cache-Control": "no-store" } },
      )
    : fail("Sign in to continue.", 401);
}
export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  if (!sameOrigin(request))
    return fail(
      "This request could not be verified. Reload and try again.",
      403,
    );
  const action = (await context.params).action;
  if (action === "logout") {
    const { cookies } = await import("next/headers");
    await revokeSession((await cookies()).get(SESSION_COOKIE)?.value);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, "", {
      ...sessionCookieOptions,
      maxAge: 0,
    });
    return response;
  }
  if (!["login", "register", "setup", "setup-info"].includes(action))
    return fail("Not found.", 404);
  try {
    if (Number(request.headers.get("content-length")) > 8192)
      return fail("Request is too large.", 413);
    const raw = await request.text();
    if (raw.length > 8192) return fail("Request is too large.", 413);
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body))
      return fail("Invalid request.");
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "local";
    if (!(await throttle("ip:" + ip, 40)))
      return fail("Too many attempts. Please try again in 15 minutes.", 429);
    if (action === "setup-info") {
      const [setup] = await db
        .select()
        .from(authBootstrap)
        .where(
          and(
            eq(authBootstrap.id, "owner"),
            eq(authBootstrap.tokenHash, tokenHash(String(body.token || ""))),
            isNull(authBootstrap.claimedAt),
          ),
        );
      if (!setup || setup.expiresAt < new Date())
        return fail("This setup link is invalid or has expired.", 403);
      return NextResponse.json({ email: setup.email, brandName: "GloVibe" });
    }
    const { email, password } = credentials(body);
    if (!(await throttle("email:" + email, 10)))
      return fail("Too many attempts. Please try again in 15 minutes.", 429);
    if (action === "login") {
      const [user] = await db
        .select()
        .from(authUsers)
        .where(eq(authUsers.email, email));
      // Equal-cost password work for unknown email addresses.
      const stored =
        user?.passwordHash ||
        "scrypt:00000000000000000000000000000000:" + "0".repeat(128);
      const valid = await verifyPassword(password, stored);
      if (!user || !valid) return fail("Email or password is incorrect.", 401);
      return signedIn(user.id);
    }
    const passwordHash = await hashPassword(password);
    const user = await db.transaction(async (tx) => {
      if (action === "setup") {
        const [setup] = await tx
          .select()
          .from(authBootstrap)
          .where(eq(authBootstrap.id, "owner"))
          .for("update");
        if (
          !setup ||
          setup.claimedAt ||
          setup.expiresAt < new Date() ||
          setup.email !== email ||
          setup.tokenHash !== tokenHash(String(body.token || ""))
        )
          throw new Error("This setup link is invalid or has expired.");
        const [created] = await tx
          .insert(authUsers)
          .values({
            email,
            passwordHash,
            brandProfileId: setup.brandProfileId,
            role: "owner",
          })
          .returning();
        await tx
          .update(authBootstrap)
          .set({ claimedAt: new Date() })
          .where(eq(authBootstrap.id, "owner"));
        return created;
      }
      const [reserved] = await tx
        .select()
        .from(authBootstrap)
        .where(eq(authBootstrap.email, email));
      if (reserved)
        throw new Error(
          "This email belongs to an existing workspace. Use its setup link or sign in.",
        );
      const { name, domain } = brandDetails(body);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${domain}))`);
      const [existing] = await tx
        .select({ id: brandProfiles.id })
        .from(brandProfiles)
        .where(eq(brandProfiles.domain, domain));
      if (existing)
        throw new Error(
          "A workspace already exists for this website. Sign in with its owner account.",
        );
      const [brand] = await tx
        .insert(brandProfiles)
        .values({
          name,
          domain,
          primaryColor: "#087f68",
          secondaryColor: "#dceee8",
          fontFamily: "Inter",
          hashtags: [],
        })
        .returning();
      const [created] = await tx
        .insert(authUsers)
        .values({
          email,
          passwordHash,
          brandProfileId: brand.id,
          role: "brand",
        })
        .returning();
      return created;
    });
    return signedIn(user.id);
  } catch (error) {
    const code =
      (error as { code?: string; cause?: { code?: string } }).code ||
      (error as { cause?: { code?: string } }).cause?.code;
    if (code === "23505")
      return fail("An account already exists. Sign in instead.", 409);
    if (error instanceof SyntaxError) return fail("Invalid request.");
    if (
      error instanceof Error &&
      !/Failed query|connect|database|relation|ECONN/i.test(error.message)
    )
      return fail(error.message);
    console.error("Brand authentication request failed");
    return fail("Sign-in is temporarily unavailable. Please try again.", 503);
  }
}
