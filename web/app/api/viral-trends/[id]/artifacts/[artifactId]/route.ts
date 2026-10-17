import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trendItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * Removes an artifact slot. readyForRemix and artifacts are interlinked
 * (see [id]/route.ts PATCH for the other direction — can't mark ready
 * without an uploaded artifact): deleting the last uploaded artifact here
 * un-readies the reel too, so "✅ Ready" can never point at zero artifacts.
 */
export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/viral-trends/[id]/artifacts/[artifactId]">) {
  const { id, artifactId } = await ctx.params;

  const [item] = await db.select().from(trendItems).where(eq(trendItems.id, id));
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });

  const artifacts = (item.artifacts ?? []).filter((a) => a.id !== artifactId);
  const stillHasUploaded = artifacts.some((a) => a.status === "uploaded");

  const set: Partial<typeof trendItems.$inferInsert> = { artifacts, updatedAt: new Date() };
  if (item.readyForRemix && !stillHasUploaded) {
    set.readyForRemix = false;
    set.readyMarkedAt = null;
  }

  const [updated] = await db.update(trendItems).set(set).where(eq(trendItems.id, id)).returning();

  return NextResponse.json({ item: updated });
}
