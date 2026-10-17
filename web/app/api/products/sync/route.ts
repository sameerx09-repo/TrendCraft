import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest/client";
import { getOrCreateCurrentBrand } from "@/lib/db/getOrCreateBrand";

/**
 * Real trigger — same shape as /api/trends/refresh. Uses brand.domain (the
 * real column, already there for the brand's own site) as the Shopify
 * storefront domain. Fires async via Inngest (syncProductCatalogForBrand)
 * and returns immediately; the actual fetch+upsert happens in that function.
 */
export async function POST() {
  const brand = await getOrCreateCurrentBrand();

  await inngest.send({
    name: "products/sync.requested",
    data: { brandProfileId: brand.id, domain: brand.domain },
  });

  return NextResponse.json({ accepted: true, brandProfileId: brand.id, domain: brand.domain }, { status: 202 });
}
