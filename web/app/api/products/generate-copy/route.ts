import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest/client";
import { getOrCreateCurrentBrand } from "@/lib/db/getOrCreateBrand";

/**
 * The paid step, triggered separately from /api/products/sync on purpose —
 * see generateProductCopyForBrand's doc comment in lib/inngest/functions.ts.
 * Real cost: one OpenRouter call (anthropic/claude-haiku-4.5) per product
 * with no slotValues yet — a few thousand tokens total for a small catalog.
 */
export async function POST() {
  const brand = await getOrCreateCurrentBrand();

  await inngest.send({
    name: "products/generate-copy.requested",
    data: { brandProfileId: brand.id },
  });

  return NextResponse.json({ accepted: true, brandProfileId: brand.id }, { status: 202 });
}
