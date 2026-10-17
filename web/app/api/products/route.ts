import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { products } from "@/lib/db/schema";
import { getOrCreateCurrentBrand } from "@/lib/db/getOrCreateBrand";
import { eq, desc } from "drizzle-orm";
import { withTtlCache } from "@/lib/db/ttlCache";

const CACHE_TTL_MS = 15_000;

/** Real product catalog list — same shape as /api/content-library. */
export async function GET() {
  const brand = await getOrCreateCurrentBrand();

  return NextResponse.json(
    await withTtlCache("products", brand.id, CACHE_TTL_MS, async () => {
      const items = await db
        .select()
        .from(products)
        .where(eq(products.brandProfileId, brand.id))
        .orderBy(desc(products.updatedAt));

      return {
        total: items.length,
        withSlotValues: items.filter((p) => p.slotValues != null).length,
        items,
      };
    })
  );
}
