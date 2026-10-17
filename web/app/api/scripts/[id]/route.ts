import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { remixedScripts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/** Real edit-persistence for the Review card's edit modal — until now,
 * slides/caption/hashtags could only be set once at generation time, with
 * no way to fix a bad line before rendering. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/scripts/[id]">) {
  const { id } = await ctx.params;
  const [script] = await db.select().from(remixedScripts).where(eq(remixedScripts.id, id));
  if (!script) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ script });
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/scripts/[id]">) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const updates: Partial<typeof remixedScripts.$inferInsert> = {};
  if (Array.isArray(body.slides)) {
    updates.slides = body.slides;
    // slideshow render reads .slides, persona-remix render reads .beats —
    // both got the same 3 lines at generation time (see
    // remixSkeletonMatchedItems), so an edit has to update both or one
    // render path silently keeps showing the pre-edit text.
    updates.beats = body.slides;
    updates.hook = body.slides[0] ?? null;
  }
  if (typeof body.caption === "string") updates.caption = body.caption;
  if (Array.isArray(body.hashtags)) updates.hashtags = body.hashtags;
  if (body.language === "english" || body.language === "hinglish") updates.language = body.language;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "no valid fields to update" }, { status: 400 });
  }

  const [updated] = await db.update(remixedScripts).set(updates).where(eq(remixedScripts.id, id)).returning();
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ script: updated });
}
