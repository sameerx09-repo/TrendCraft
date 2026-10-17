import { inngest } from "@/lib/inngest/client";
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { sessionForToken } from "@/lib/auth/session";
import { SESSION_COOKIE, sameOrigin, safeReturnPath } from "@/lib/auth/policy";
import { ownsResource, ownsAsset } from "@/lib/auth/access";
import { validMediaSignature } from "@/lib/auth/media-signature";
const privateMedia = /^\/(storage|brand-feed|runway-clips|viral-trend-clips)\//;
function workerAllowed(request: NextRequest) {
  const actual = request.nextUrl.searchParams.get("workerToken") || "",
    expected = process.env.AUTH_WORKER_TOKEN || "";
  return (
    /^[a-f0-9]{64}$/.test(actual) &&
    expected.length >= 64 &&
    actual.length === expected.length &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  );
}
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (
    path === "/login" ||
    path.startsWith("/api/auth/") ||
    path.startsWith("/persona-library/") ||
    path === "/robots.txt"
  )
    return NextResponse.next();
  if (path === "/api/inngest") {
    if (workerAllowed(request)) return NextResponse.next();
    if (
      process.env.INNGEST_SIGNING_KEY &&
      inngest.mode === "cloud" &&
      request.headers.has("x-inngest-signature")
    )
      return NextResponse.next();
    return NextResponse.json(
      { error: "Authenticated worker requests only." },
      { status: 401 },
    );
  }
  if (privateMedia.test(path) && validMediaSignature(request.nextUrl))
    return NextResponse.next();
  try {
    const session = await sessionForToken(
      request.cookies.get(SESSION_COOKIE)?.value,
    );
    if (!session) {
      if (path.startsWith("/api/") || privateMedia.test(path))
        return NextResponse.json(
          { error: "Sign in to continue." },
          { status: 401 },
        );
      const url = new URL("/login", request.url);
      url.searchParams.set(
        "next",
        safeReturnPath(path + request.nextUrl.search),
      );
      return NextResponse.redirect(url);
    }
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      !sameOrigin(request)
    )
      return NextResponse.json(
        { error: "Request origin could not be verified." },
        { status: 403 },
      );
    if (
      (path.startsWith("/api/dev/") ||
        (path === "/api/config" && request.method !== "GET")) &&
      session.role !== "owner"
    )
      return NextResponse.json(
        { error: "Workspace owner access required." },
        { status: 403 },
      );
    if (path === "/api/engagement/submit" && session.role !== "owner") {
      const body = await request
        .clone()
        .json()
        .catch(() => ({}));
      if (body.testDelivery !== "local")
        return NextResponse.json(
          {
            error:
              "Connect this workspace to its SwayBees brand account before sending tasks.",
          },
          { status: 403 },
        );
    }
    const match = path.match(
      /^\/api\/(posts|scripts|product-ads|content-library|trend-items|viral-trends)\/([^/]+)/,
    );
    if (
      match &&
      !["generate", "import"].includes(match[2]) &&
      !(await ownsResource(match[1], match[2], session.brand.id))
    )
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (privateMedia.test(path) && !(await ownsAsset(path, session.brand.id)))
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch {
    return NextResponse.json(
      { error: "Your session could not be checked. Please try again." },
      { status: 503 },
    );
  }
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
