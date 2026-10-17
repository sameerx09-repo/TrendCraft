import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { posts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/** Real export backend — replaces the mockup's placeholder export screen.
 * The file itself is served by the /storage/[bucket]/[key] route; this
 * just reports whether it's ready and where. */
export async function GET(_req: Request, ctx: RouteContext<"/api/posts/[id]/export">) {
  const { id } = await ctx.params;
  const [post] = await db.select().from(posts).where(eq(posts.id, id));
  if (!post) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (!post.renderedFileUrl) {
    return NextResponse.json({ status: post.status === "kept" ? "rendering" : "not_kept" }, { status: 202 });
  }

  return NextResponse.json({ status: "ready", url: post.renderedFileUrl, renderedAt: post.renderedAt });
}
