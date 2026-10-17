import { readFile } from "fs/promises";
import path from "path";
import { isMockMode } from "./mockMode";

/**
 * Real, undocumented-but-public Shopify storefront endpoint —
 * https://{domain}/products.json — no auth, no scraping fragility,
 * structured JSON. Verified live against glo-vibe.com (a genuinely real
 * Shopify store for this case-study brand, vendor "Glovibe"): 5 real
 * products, 11-14 images each, real body_html descriptions.
 *
 * `tags` came back empty on all 5 real GloVibe products, so keyword
 * matching cannot lean on Shopify tags for this brand (may differ per
 * brand) — productType + description are the real signal available without
 * a model call.
 */
export interface RawShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html: string;
  vendor: string;
  product_type: string;
  tags: string[];
  images: { src: string }[];
  variants: { price: string }[];
}

/** Strips HTML tags from Shopify's body_html — real product descriptions
 * come back as marketing copy with <p>/<meta> wrapping, not plain text. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * PRODUCT CATALOG INGESTION. Not the brand's Instagram feed — their own
 * Shopify storefront, which is public, structured, and (unlike Instagram's
 * CDN video links) returns permanent image URLs.
 *
 * Non-Shopify brands are a real gap this function doesn't cover — no
 * fallback crawler wired up yet (apify/website-content-crawler is the
 * candidate, spotted during the earlier Apify research pass but not
 * integrated). Flagged, not solved.
 */
export async function fetchShopifyProducts(domain: string): Promise<RawShopifyProduct[]> {
  if (isMockMode()) {
    const fixturePath = path.join(process.cwd(), "fixtures", "shopify", "sample-products.json");
    const raw = JSON.parse(await readFile(fixturePath, "utf-8"));
    return raw.products as RawShopifyProduct[];
  }

  const res = await fetch(`https://${domain}/products.json?limit=250`);
  if (!res.ok) throw new Error(`Shopify products.json failed for ${domain}: ${res.status}`);
  const data = (await res.json()) as { products: RawShopifyProduct[] };
  return data.products;
}
