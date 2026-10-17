import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trendItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { put } from "@/lib/storage";

/** Uploads the actual file for one artifact slot — same put()/urlFor()
 * mechanism already used for downloaded reel videos and rendered posts
 * (lib/storage/index.ts), served back via app/storage/[bucket]/[key]. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/viral-trends/[id]/artifacts/[artifactId]/upload">) {
  const { id, artifactId } = await ctx.params;
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "expected a 'file' field" }, { status: 400 });
  }

  const [item] = await db.select().from(trendItems).where(eq(trendItems.id, id));
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });

  const ext = file.name.split(".").pop() || "bin";
  const buffer = Buffer.from(await file.arrayBuffer());
  const fileUrl = await put("viral-trend-artifacts", `${artifactId}.${ext}`, buffer);

  const artifacts = (item.artifacts ?? []).map((a) =>
    a.id === artifactId ? { ...a, fileUrl, status: "uploaded" as const } : a
  );

  const [updated] = await db
    .update(trendItems)
    .set({ artifacts, updatedAt: new Date() })
    .where(eq(trendItems.id, id))
    .returning();

  return NextResponse.json({ item: updated });
}
