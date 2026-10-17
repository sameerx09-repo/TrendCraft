import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { brandProfiles, posts, products, remixedScripts, trendItems } from "@/lib/db/schema";
import { getOrCreateCurrentBrand } from "@/lib/db/getOrCreateBrand";
import { eq } from "drizzle-orm";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const productId = typeof body.productId === "string" ? body.productId : "";
  if (!productId) return NextResponse.json({ error: "productId is required" }, { status: 400 });

  try {
    const brand = await getOrCreateCurrentBrand();
    const [product] = await db.select().from(products).where(eq(products.id, productId));
    if (!product || product.brandProfileId !== brand.id) {
      return NextResponse.json({ error: "product not found" }, { status: 404 });
    }
    if (!product.imageUrl) {
      return NextResponse.json({ error: "product has no imageUrl" }, { status: 400 });
    }

    const [brandRow] = await db.select().from(brandProfiles).where(eq(brandProfiles.id, brand.id));
    const productDescription = product.description || product.slotValues?.payoff || product.title;

    const [trendItem] = await db
      .insert(trendItems)
      .values({
        brandProfileId: brand.id,
        sourceUrl: `${product.sourceUrl}#product-ad-${crypto.randomUUID()}`,
        platform: "local_upload",
        title: `Product ad: ${product.title}`,
        handle: brandRow?.name || brand.name,
        caption: productDescription,
        thumbnailUrl: product.imageUrl,
        unscored: true,
        hookLine: product.title,
        scrapedAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    const [script] = await db
      .insert(remixedScripts)
      .values({
        trendItemId: trendItem.id,
        brandProfileId: brand.id,
        angle: product.productType || "Product ad",
        hookType: "product_ad",
        hook: `${product.title} product ad`,
        beats: [product.title, productDescription, `${brandRow?.name || brand.name}. Link in bio.`],
        slides: [product.title, productDescription, `${brandRow?.name || brand.name}. Link in bio.`],
        caption: `${product.title}. ${productDescription}`,
        tags: [product.title],
        hashtags: trendItem.hashtags,
        language: "english",
      })
      .returning();

    const [post] = await db
      .insert(posts)
      .values({
        remixedScriptId: script.id,
        brandProfileId: brand.id,
        status: "pending",
        score: null,
        format: "runway_remix",
      })
      .returning();

    return NextResponse.json({ postId: post.id, renderedFileUrl: null });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "product ad generation failed" }, { status: 500 });
  }
}
