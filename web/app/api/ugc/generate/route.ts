import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { posts, remixedScripts, products } from "@/lib/db/schema";
import { getOrCreateCurrentBrand } from "@/lib/db/getOrCreateBrand";
import { getPersonaById } from "@/lib/render/personaLibrary";
import { generateReelCopy } from "@/lib/clients/reelCopywriter";
import { eq } from "drizzle-orm";

/**
 * Generate AI UGC — the new workflow sitting alongside "Remix from Viral
 * Trends" on Create Content. No sourced reel at all: an admin picks a real,
 * fully-clipped persona (personaLibrary.ts's PERSONAS, not the display-only
 * ALL_PERSONAS roster — diya/kavya are missing reveal/button clips and
 * would break mid-render) and this writes brand/product-grounded ad copy
 * for them to "read," via generateReelCopy's existing realCaption:null
 * branch (no new copywriter needed — that branch already exists for
 * exactly this "no sourced caption" case).
 *
 * Creates the script + post synchronously (small, $0-marginal-cost calls)
 * and returns the postId; the actual video render is the existing eager
 * generate-persona route, triggered the same way a Viral Trends remix's
 * post is — Create Content's own pending-post effect already calls it for
 * any format: "runway_remix" post with no renderedFileUrl, so this route
 * doesn't render anything itself.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { personaId, mode, productId } = body as {
    personaId?: string;
    mode?: "brand" | "product";
    productId?: string;
  };

  if (typeof personaId !== "string") {
    return NextResponse.json({ error: "personaId is required" }, { status: 400 });
  }
  const persona = getPersonaById(personaId);
  if (!persona) {
    return NextResponse.json({ error: `unknown or incomplete persona: ${personaId}` }, { status: 400 });
  }
  if (mode === "product" && !productId) {
    return NextResponse.json({ error: "productId required for mode 'product'" }, { status: 400 });
  }

  try {
    const brand = await getOrCreateCurrentBrand();

    let subjectName = brand.name;
    let subjectDescription = brand.identity ?? brand.toneOfVoice ?? `${brand.name}, a skincare brand.`;
    let tag = brand.name;

    if (mode === "product") {
      const [product] = await db.select().from(products).where(eq(products.id, productId!));
      if (!product) return NextResponse.json({ error: "product not found" }, { status: 404 });
      subjectName = product.title;
      subjectDescription = product.description ?? `${product.title}, a ${brand.name} product.`;
      tag = product.title;
    }

    // 3 lines, matching assignBeatRoles' setup/reveal/button structure —
    // same clip count generate-persona/route.ts's roles = assignBeatRoles(beats)
    // already assumes for every persona-library render.
    const beats = await generateReelCopy({
      subjectName,
      subjectDescription,
      clipCount: 3,
      realCaption: null,
    });

    const [script] = await db
      .insert(remixedScripts)
      .values({
        trendItemId: null,
        brandProfileId: brand.id,
        personaId: persona.id,
        hookType: null,
        hook: beats[0] ?? null,
        arc: beats[1] ?? null,
        cta: beats[beats.length - 1] ?? null,
        beats,
        caption: beats.join(" "),
        tags: [tag],
        language: "english",
      })
      .returning();

    const [post] = await db
      .insert(posts)
      .values({
        remixedScriptId: script.id,
        brandProfileId: brand.id,
        status: "pending",
        format: "runway_remix",
      })
      .returning();

    return NextResponse.json({ postId: post.id });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI UGC generation failed" }, { status: 500 });
  }
}
