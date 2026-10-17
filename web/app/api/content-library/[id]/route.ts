import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trendItems, remixedScripts, posts } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

/** Detail view: the trend item plus its real remix history (join
 * remixed_scripts -> posts by trend_item_id), for the "Remixed into" list
 * the mockup's libModal showed from client-side session data only. */
export async function GET(_req: Request, ctx: RouteContext<"/api/content-library/[id]">) {
  const { id } = await ctx.params;

  const [item] = await db.select().from(trendItems).where(eq(trendItems.id, id));
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });

  const scripts = await db
    .select()
    .from(remixedScripts)
    .where(eq(remixedScripts.trendItemId, id))
    .orderBy(desc(remixedScripts.createdAt));

  // One query per script keeps this simple and correct for MVP volumes
  // (a handful of remixes per item) rather than a single N-way IN() query.
  const remixHistory = await Promise.all(
    scripts.map(async (script) => {
      const scriptPosts = await db.select().from(posts).where(eq(posts.remixedScriptId, script.id));
      return { script, posts: scriptPosts };
    })
  );

  return NextResponse.json({ item, remixHistory });
}
