import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trendItems } from "@/lib/db/schema";
import { getOrCreateCurrentBrand } from "@/lib/db/getOrCreateBrand";
import { extractHook } from "@/lib/discovery/extractHook";
import { matchSkeletons } from "@/lib/render/skeletonLibrary";
import { invalidateTtlCache } from "@/lib/db/ttlCache";

/** Minimal CSV line splitter — handles double-quoted fields containing
 * commas (captions routinely do), not a full RFC4180 parser. Fine for an
 * admin-only bulk-import tool, not for arbitrary untrusted CSVs. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields.map((f) => f.trim());
}

/** Shared upsert — same onConflictDoUpdate-on-sourceUrl pattern the
 * auto-scrape pipeline uses (lib/inngest/functions.ts). hookLine/
 * matchedSkeletons computed with the same pure, free, local functions the
 * auto-scrape pipeline uses — no Claude/API call needed, and this is what
 * makes an imported reel immediately eligible in remixSkeletonMatchedItems's
 * candidate query the moment it's marked ready. */
async function upsertManualReel(brandId: string, url: string, caption?: string, handle?: string) {
  const hookLine = extractHook(caption);
  const matchedSkeletons = matchSkeletons(hookLine);

  await db
    .insert(trendItems)
    .values({
      brandProfileId: brandId,
      sourceUrl: url,
      platform: "manual_viral",
      caption: caption || null,
      handle: handle || null,
      hookLine,
      matchedSkeletons,
      readyForRemix: false,
      artifacts: [],
      scrapedAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [trendItems.brandProfileId, trendItems.sourceUrl],
      set: {
        caption: caption || null,
        handle: handle || null,
        hookLine,
        matchedSkeletons,
        updatedAt: new Date(),
      },
    });
}

/**
 * Bulk-import manually-sourced viral reel links. Accepts either (or both):
 * - a CSV file field ("file") — columns: url (required), caption, handle
 * - a plain-text field ("urls") — one URL per line, no caption/handle
 *   (the paste-a-list-of-links shortcut, no spreadsheet needed)
 */
export async function POST(req: Request) {
  const brand = await getOrCreateCurrentBrand();
  const form = await req.formData();
  const file = form.get("file");
  const urlsText = form.get("urls");

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  if (file instanceof File) {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length > 0) {
      const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
      const urlIdx = header.indexOf("url");
      const captionIdx = header.indexOf("caption");
      const handleIdx = header.indexOf("handle");
      if (urlIdx === -1) {
        return NextResponse.json({ error: "CSV must have a 'url' column" }, { status: 400 });
      }

      for (let i = 1; i < lines.length; i++) {
        const row = parseCsvLine(lines[i]);
        const url = row[urlIdx]?.trim();
        if (!url) {
          skipped++;
          continue;
        }
        try {
          await upsertManualReel(brand.id, url, captionIdx !== -1 ? row[captionIdx] : undefined, handleIdx !== -1 ? row[handleIdx] : undefined);
          imported++;
        } catch (e) {
          errors.push(`row ${i + 1} (${url}): ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  if (typeof urlsText === "string" && urlsText.trim().length > 0) {
    const rawLines = urlsText
      .split(/\r?\n/)
      .map((u) => u.trim())
      .filter((u) => u.length > 0);

    // Some sources (chat apps, notes) wrap a long URL's query string onto
    // its own line when copied — confirmed live: a real paste split
    // ".../reel/Db1Kr0evX_8/?" and "stkn=a2d5NHdoZXlxd2Q0" into two lines,
    // which naive one-URL-per-line splitting turned into two broken rows
    // instead of one real one. A continuation line (doesn't start with a
    // scheme) gets glued onto the previous URL, no separator — that's
    // exactly the missing half of the query string, not a new URL.
    const urls: string[] = [];
    for (const line of rawLines) {
      if (/^https?:\/\//i.test(line) || urls.length === 0) {
        urls.push(line);
      } else {
        urls[urls.length - 1] += line;
      }
    }

    for (const url of urls) {
      try {
        await upsertManualReel(brand.id, url);
        imported++;
      } catch (e) {
        errors.push(`${url}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  if (!(file instanceof File) && !(typeof urlsText === "string" && urlsText.trim().length > 0)) {
    return NextResponse.json({ error: "expected a 'file' (CSV) or 'urls' (pasted links) field" }, { status: 400 });
  }

  if (imported > 0) invalidateTtlCache("viral-trends");
  return NextResponse.json({ imported, skipped, errors });
}
