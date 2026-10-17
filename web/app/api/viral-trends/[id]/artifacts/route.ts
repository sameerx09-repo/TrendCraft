import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trendItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

/** Admin adds a new artifact SLOT (label only, e.g. "reaction subject
 * photo") — uploading the actual file is a separate step (upload/route.ts),
 * so an admin can plan out what's needed before sourcing each one. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/viral-trends/[id]/artifacts">) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label) return NextResponse.json({ error: "label is required" }, { status: 400 });

  const [item] = await db.select().from(trendItems).where(eq(trendItems.id, id));
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });

  const artifacts = [...(item.artifacts ?? []), { id: randomUUID(), label, fileUrl: null, status: "needed" as const }];

  const [updated] = await db
    .update(trendItems)
    .set({ artifacts, updatedAt: new Date() })
    .where(eq(trendItems.id, id))
    .returning();

  return NextResponse.json({ item: updated });
}
