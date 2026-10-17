import { agentRenderAuthorization } from "@/lib/mission-control/agent-render-authorization";
import { readCampaigns } from "@/lib/mission-control/store";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import {
  brandProfiles,
  posts,
  remixedScripts,
  trendItems,
} from "@/lib/db/schema";
import { put } from "@/lib/storage";
import { savePosterFrame } from "@/lib/render/poster";
import { and, eq } from "drizzle-orm";

let cachedRunwayKey: {
  key: string;
  checkedAt: number;
  credits: number;
} | null = null;

async function runwayKeyCandidates() {
  const candidates = new Set<string>();
  if (process.env.RUNWAY_API_KEY) candidates.add(process.env.RUNWAY_API_KEY);

  try {
    const envText = await readFile(
      path.join(process.cwd(), ".env.local"),
      "utf8",
    );
    for (const line of envText.split(/\r?\n/)) {
      const match = line.match(/^#?RUNWAY_API_KEY=(.+)$/);
      if (match?.[1]) candidates.add(match[1].trim());
    }
  } catch {
    // Production may not have a readable .env.local; the active env var above is enough there.
  }

  return Array.from(candidates).filter(Boolean);
}

async function pickRunwayKey() {
  if (cachedRunwayKey && Date.now() - cachedRunwayKey.checkedAt < 5 * 60_000)
    return cachedRunwayKey.key;

  const candidates = await runwayKeyCandidates();
  if (candidates.length === 0) throw new Error("RUNWAY_API_KEY is not set");

  let best: { key: string; credits: number } | null = null;
  for (const key of candidates) {
    const res = await fetch("https://api.dev.runwayml.com/v1/organization", {
      headers: {
        Authorization: `Bearer ${key}`,
        "X-Runway-Version": "2024-11-06",
      },
    });
    const text = await res.text();
    const credits = res.ok
      ? Number(
          (JSON.parse(text) as { creditBalance?: number }).creditBalance ?? -1,
        )
      : -1;
    if (!best || credits > best.credits) best = { key, credits };
  }

  if (!best || best.credits <= 0)
    throw new Error("No Runway API key with available credits found");
  cachedRunwayKey = { ...best, checkedAt: Date.now() };
  return best.key;
}

async function imageUrlToDataUri(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`product image fetch failed: ${res.status}`);
  const contentType = res.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await res.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

async function createRunwayGen45ProductVideo(input: {
  apiKey: string;
  imageDataUri: string;
  productName: string;
  productDescription: string;
  brandName: string;
  creativeDirection?: string | null;
  onTaskCreated?: (id: string) => Promise<void>;
}) {
  const prompt = [
    `Create a premium vertical product beauty video for ${input.brandName} ${input.productName}.`,
    "Use the supplied product image as the exact hero product.",
    "No people, no hands, no faces, no fake testimonial, no readable text overlays.",
    "Keep the product centered, premium, realistic, and recognizable.",
    input.creativeDirection ||
      "Use a slow cinematic push-in, warm bathroom-vanity lighting, subtle steam, and dewy reflections.",
    "Preserve packaging shape, label colors, and bottle identity as much as possible.",
    `Ground the visual mood in this product description: ${input.productDescription}`,
  ].join(" ");

  const created = await fetch(
    "https://api.dev.runwayml.com/v1/image_to_video",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
        "X-Runway-Version": "2024-11-06",
      },
      body: JSON.stringify({
        model: "gen4.5",
        promptImage: input.imageDataUri,
        promptText: prompt,
        ratio: "720:1280",
        duration: 4,
      }),
    },
  );
  const createText = await created.text();
  if (!created.ok)
    throw new Error(
      `Runway Gen-4.5 create failed: ${created.status} ${createText}`,
    );
  const createData = JSON.parse(createText) as { id?: string };
  if (!createData.id)
    throw new Error(`Runway Gen-4.5 create response missing id: ${createText}`);

  await input.onTaskCreated?.(createData.id);
  const deadline = Date.now() + 9 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 6000));
    const polled = await fetch(
      `https://api.dev.runwayml.com/v1/tasks/${createData.id}`,
      {
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "X-Runway-Version": "2024-11-06",
        },
      },
    );
    const pollText = await polled.text();
    if (!polled.ok)
      throw new Error(
        `Runway Gen-4.5 poll failed: ${polled.status} ${pollText}`,
      );
    const pollData = JSON.parse(pollText) as {
      status: string;
      output?: string[] | string;
    };
    if (pollData.status === "SUCCEEDED") {
      const outputUrl = Array.isArray(pollData.output)
        ? pollData.output[0]
        : pollData.output;
      if (!outputUrl)
        throw new Error(
          `Runway Gen-4.5 task succeeded without output: ${pollText}`,
        );
      const video = await fetch(outputUrl);
      if (!video.ok)
        throw new Error(
          `Runway Gen-4.5 output download failed: ${video.status}`,
        );
      return Buffer.from(await video.arrayBuffer());
    }
    if (["FAILED", "THROTTLED", "CANCELLED"].includes(pollData.status)) {
      throw new Error(`Runway Gen-4.5 task ${pollData.status}: ${pollText}`);
    }
  }
  throw new Error(
    "Runway generation timed out. Check your Runway task before retrying.",
  );
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ postId: string }> },
) {
  const { postId } = await params;

  try {
    const [row] = await db
      .select({
        post: posts,
        script: remixedScripts,
        trendItem: trendItems,
        brand: brandProfiles,
      })
      .from(posts)
      .innerJoin(remixedScripts, eq(posts.remixedScriptId, remixedScripts.id))
      .innerJoin(trendItems, eq(remixedScripts.trendItemId, trendItems.id))
      .leftJoin(brandProfiles, eq(posts.brandProfileId, brandProfiles.id))
      .where(
        and(
          eq(posts.id, postId),
          eq(trendItems.platform, "local_upload"),
          eq(remixedScripts.hookType, "product_ad"),
        ),
      );

    if (!row)
      return NextResponse.json(
        { error: "product ad post not found" },
        { status: 404 },
      );
    if (row.post.renderedFileUrl)
      return NextResponse.json({
        postId,
        renderedFileUrl: row.post.renderedFileUrl,
      });
    if (!row.trendItem.thumbnailUrl)
      return NextResponse.json(
        { error: "product ad has no product image" },
        { status: 400 },
      );

    const authorization = agentRenderAuthorization(_req, postId);
    const agentPilot =
      row.post.brandProfileId &&
      (await readCampaigns(row.post.brandProfileId)).some((c) =>
        c.creatives.some((r) => r.postId === postId && r.agentPilot),
      );
    if (agentPilot && !authorization)
      return NextResponse.json(
        {
          error:
            "Agent pilots require a single-shot approval from the current preview.",
        },
        { status: 403 },
      );
    const apiKey = await pickRunwayKey();
    const imageDataUri =
      authorization?.imageDataUri ??
      (await imageUrlToDataUri(
        new URL(row.trendItem.thumbnailUrl, _req.url).href,
      ));
    const productName =
      row.script.tags?.[0] ||
      row.script.hook?.replace(/ product ad$/i, "") ||
      row.trendItem.title ||
      "Product";
    const productDescription =
      row.trendItem.caption || row.script.caption || productName;
    const brandName = row.brand?.name || row.trendItem.handle || "Brand";

    const videoBuffer = await createRunwayGen45ProductVideo({
      apiKey,
      imageDataUri,
      productName,
      productDescription,
      brandName,
      creativeDirection: row.script.arc,
      onTaskCreated: authorization?.onTaskCreated,
    });
    const renderedFileUrl = await put(
      "rendered-posts",
      `${postId}-product-ad.mp4`,
      videoBuffer,
    );
    await savePosterFrame(postId, videoBuffer);
    await db
      .update(posts)
      .set({ renderedFileUrl, renderedAt: new Date(), updatedAt: new Date() })
      .where(eq(posts.id, postId));

    return NextResponse.json({ postId, renderedFileUrl });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "product ad render failed" },
      { status: 500 },
    );
  }
}
