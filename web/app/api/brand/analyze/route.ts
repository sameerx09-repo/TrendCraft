import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { brandProfiles } from "@/lib/db/schema";
import { getOrCreateCurrentBrand } from "@/lib/db/getOrCreateBrand";
import { analyzeBrandSite } from "@/lib/clients/brandAnalyzer";
import { eq } from "drizzle-orm";

/** "Re-scan site" — real identity/tone/segments/colors extraction, not a
 * placeholder. See lib/clients/brandAnalyzer.ts for what's actually real
 * (an AI read of the homepage) vs. deterministic (a frequency scan of the
 * site's own CSS). */
export async function POST() {
  const brand = await getOrCreateCurrentBrand();
  try {
    const analysis = await analyzeBrandSite(brand.domain);
    const [updated] = await db
      .update(brandProfiles)
      .set({
        identity: analysis.identity,
        toneOfVoice: analysis.toneOfVoice,
        targetSegments: analysis.targetSegments,
        extractedColors: analysis.colors,
        lastAnalyzedAt: new Date(),
      })
      .where(eq(brandProfiles.id, brand.id))
      .returning();
    return NextResponse.json({ brand: updated });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "analysis failed" }, { status: 500 });
  }
}
