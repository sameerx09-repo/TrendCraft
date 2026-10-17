"use client";
import { PageHeader } from "../PageHeader";
import Link from "next/link";
import {
  RefreshCw,
  Megaphone,
  Shuffle,
  Users,
  Package,
  Share2,
  Trash2,
  X,
  FileVideo,
} from "lucide-react";

import { useEffect, useState, useCallback, useRef } from "react";
import { EditModal } from "../EditModal";
import { OnboardingScreen } from "../OnboardingScreen";
import { useBrand } from "../BrandSession";
import { SKELETONS, type SkeletonId } from "@/lib/render/skeletonLibrary";
import { ALL_PERSONAS } from "@/lib/render/personaLibrary";
import { InstagramEmbed, useInstagramEmbedScript } from "../InstagramEmbed";
import { MediaGrid } from "../MediaGrid";

function isInstagramUrl(url: string): boolean {
  return url.includes("instagram.com");
}

interface RemixPost {
  post: {
    id: string;
    status: string;
    score: number | null;
    renderedFileUrl: string | null;
    format: string;
    createdAt: string;
  };
  script: {
    id: string;
    hook: string | null;
    hookType: string | null;
    angle: string | null;
    slides: string[] | null;
    caption: string | null;
    hashtags: string[] | null;
    tags: string[] | null;
    language: string;
  };
  trendItem: {
    id: string;
    platform: string;
    handle: string | null;
    title: string | null;
    caption: string | null;
    viewCount: number | null;
    sourceUrl: string;
    sourceVideoUrl: string | null;
    thumbnailUrl: string | null;
  };
}

function compactCount(n: number): string {
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

type StatusFilter = "all" | "pending" | "kept" | "discarded";

/** Same real feature-detection + fallback as Exports page's identical
 * helper — Share/Download now lives right on the card here too, not just
 * gated behind marking a post Keep and going to Exports first. Kept as its
 * own copy rather than a shared import, same convention as this file's
 * other small helpers. */
async function shareOrDownload(videoUrl: string, title: string) {
  try {
    const res = await fetch(videoUrl);
    const blob = await res.blob();
    const file = new File([blob], "remix.mp4", {
      type: blob.type || "video/mp4",
    });
    const nav = navigator as Navigator & {
      canShare?: (data: { files: File[] }) => boolean;
      share?: (data: ShareData) => Promise<void>;
    };
    if (nav.canShare?.({ files: [file] }) && nav.share) {
      await nav.share({ files: [file], title, text: title });
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "remix.mp4";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return;
    window.open(videoUrl, "_blank");
  }
}

/** Human-readable label for a trend_item.platform value — "manual_viral" is
 * the Viral Trends page's own reels (see lib/db/schema.ts), everything else
 * is the auto-scrape pipeline's platforms. */
const SOURCE_LABELS: Record<string, string> = {
  ai_ugc: "AI UGC",
  brand_remix: "Brand remix",
  manual_viral: "Viral Trends",
  instagram: "Instagram",
  youtube: "YouTube",
  local_upload: "Product Ad",
};

export default function RemixesPage() {
  const brand = useBrand();
  useInstagramEmbedScript();
  const [posts, setPosts] = useState<RemixPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  // The API already orders by createdAt desc, so "Newest" here is a no-op
  // sort today — the point is making that order an explicit, visible,
  // trustable control instead of an implicit default nobody can see or
  // rely on ("I don't see any filter to check what I remixed latest").
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [remixing, setRemixing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mockMode, setMockMode] = useState(true);

  // Shared by both pickers below (Viral Trends remix and AI UGC) — same
  // brand-vs-product choice either way, just a different source step
  // above it.
  const [remixMode, setRemixMode] = useState<"product" | "brand">("product");
  const [remixProductId, setRemixProductId] = useState<string>("");
  const [pickerProducts, setPickerProducts] = useState<
    { id: string; title: string }[]
  >([]);
  const [loadingPickerProducts, setLoadingPickerProducts] = useState(false);

  // "Remix from Viral Trends" — replaces the old "Remix from skeletons"
  // (which silently pulled from the auto-scraped pool). Always sources
  // from Viral Trends' curated & ready reels now — auto-picks up to 5 (all
  // of them if fewer exist), no manual single-reel choice; a brand doesn't
  // pick which specific reel, just sees what's about to get remixed.
  const [showViralTrendsPicker, setShowViralTrendsPicker] = useState(false);
  const [readyTrendItems, setReadyTrendItems] = useState<
    {
      id: string;
      handle: string | null;
      hookLine: string | null;
      caption: string | null;
    }[]
  >([]);
  const [loadingReadyTrendItems, setLoadingReadyTrendItems] = useState(false);

  // "Generate AI UGC" — the new, separate workflow: an AI persona reads
  // brand/product copy, no sourced reel at all.
  const [showUgcPicker, setShowUgcPicker] = useState(false);
  const [ugcPersonas, setUgcPersonas] = useState<
    { id: string; label: string; anchorPhoto: string }[]
  >([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>("");
  const [ugcGenerating, setUgcGenerating] = useState(false);
  const [showProductAdPicker, setShowProductAdPicker] = useState(false);
  const [productAdGenerating, setProductAdGenerating] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Real, confirmed live: every card in this grid used to mount its own
  // <video preload="metadata"> unconditionally — with 88+ posts that's 88+
  // simultaneous requests competing for the browser's small per-origin
  // connection limit, and a NEW request (opening a post's detail view, or
  // navigating to another page entirely) can end up queued behind all of
  // them, appearing to hang forever even though nothing actually errored.
  // Only mounting the real <video> for the one card the mouse is actually
  // over — instead of all of them — is what fixes that; every other card
  // just shows its static gradient background until hovered.
  const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);
  // Posts rendered before savePosterFrame existed have no poster file —
  // 404s silently into this set instead of showing a broken-image icon,
  // falling back to the plain gradient (the previous, only-ever behavior).
  const [posterFailed, setPosterFailed] = useState<Record<string, boolean>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [showWhy, setShowWhy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [acting, setActing] = useState(false);

  const [originalUrls, setOriginalUrls] = useState<Record<string, string>>({});
  const [fetchingOriginal, setFetchingOriginal] = useState(false);
  const [originalError, setOriginalError] = useState<string | null>(null);
  const [runwayUrls, setRunwayUrls] = useState<Record<string, string>>({});
  const [runwayErrors, setRunwayErrors] = useState<Record<string, string>>({});
  const [generatingRealAi, setGeneratingRealAi] = useState(false);
  const requestedOriginal = useRef(new Set<string>());
  const requestedRunway = useRef(new Set<string>());
  const autoRenderedOnce = useRef(false);

  // Same reasoning as Generate Content's identical helper: persona-library
  // renders are $0, so there's no real cost being saved by waiting for a
  // click — only wall-clock time that gets spent the moment you look
  // anyway. Returns a Promise so the batch-wide effect below can queue
  // these instead of firing all of them at once (confirmed live elsewhere
  // that unqueued concurrent renders compete for CPU hard enough to slow
  // every one of them down).
  // format picks the endpoint: "artifact_remix" posts (a manual_viral reel
  // with real uploaded artifacts) render through generate-artifact-remix
  // instead of the generic persona pool — see lib/inngest/functions.ts's
  // remixSkeletonMatchedItems, which decides this once at creation time.
  const requestPersonaRender = useCallback(
    (postId: string, format: string): Promise<void> => {
      if (requestedRunway.current.has(postId)) return Promise.resolve();
      requestedRunway.current.add(postId);
      const endpoint =
        format === "artifact_remix"
          ? "generate-artifact-remix"
          : "generate-persona";
      return fetch(`/api/posts/${postId}/${endpoint}`, { method: "POST" })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok)
            throw new Error(data.error ?? `generation failed (${res.status})`);
          setRunwayUrls((prev) => ({
            ...prev,
            [postId]: data.renderedFileUrl,
          }));
          setPosts((prev) =>
            prev.map((p) =>
              p.post.id === postId
                ? {
                    ...p,
                    post: { ...p.post, renderedFileUrl: data.renderedFileUrl },
                  }
                : p,
            ),
          );
        })
        .catch((e) => {
          setRunwayErrors((prev) => ({
            ...prev,
            [postId]: e instanceof Error ? e.message : "generation failed",
          }));
          requestedRunway.current.delete(postId);
        });
    },
    [],
  );

  const loadPosts = useCallback(async () => {
    try {
      const res = await fetch("/api/remixes");
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok)
        throw new Error(data.error ?? `Failed to load remixes (${res.status})`);
      setPosts(data.posts ?? []);
      setError(null);
    } catch (e) {
      setPosts([]);
      setError(e instanceof Error ? e.message : "Failed to load remixes");
    } finally {
      setLoading(false);
      window.dispatchEvent(new Event("review-queue-changed"));
    }
  }, []);

  useEffect(() => {
    loadPosts();
    fetch("/api/config")
      .then((res) => res.json())
      .then((data) => setMockMode(data.mockMode))
      .catch(() => {});
  }, [loadPosts]);

  const selected = posts.find((p) => p.post.id === selectedId) ?? null;
  const currentOriginalUrl = selected
    ? (originalUrls[selected.trendItem.id] ?? selected.trendItem.sourceVideoUrl)
    : null;
  const currentRunwayUrl = selected
    ? (runwayUrls[selected.post.id] ?? selected.post.renderedFileUrl)
    : null;

  async function handleGenerateRealAi() {
    if (!selected) return;
    const postId = selected.post.id;
    setGeneratingRealAi(true);
    setRunwayErrors((prev) => ({ ...prev, [postId]: "" }));
    try {
      const res = await fetch(`/api/posts/${postId}/generate-runway`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error ?? `generation failed (${res.status})`);
      setRunwayUrls((prev) => ({ ...prev, [postId]: data.renderedFileUrl }));
      setPosts((prev) =>
        prev.map((p) =>
          p.post.id === postId
            ? {
                ...p,
                post: { ...p.post, renderedFileUrl: data.renderedFileUrl },
              }
            : p,
        ),
      );
    } catch (e) {
      setRunwayErrors((prev) => ({
        ...prev,
        [postId]: e instanceof Error ? e.message : "generation failed",
      }));
    } finally {
      setGeneratingRealAi(false);
    }
  }

  async function loadPickerProducts() {
    setLoadingPickerProducts(true);
    try {
      const res = await fetch("/api/products");
      const data = await res.json();
      const list = (data.items ?? []).map(
        (p: { id: string; title: string }) => ({ id: p.id, title: p.title }),
      );
      setPickerProducts(list);
      if (list.length > 0) setRemixProductId((prev) => prev || list[0].id);
    } catch {
      setPickerProducts([]);
    } finally {
      setLoadingPickerProducts(false);
    }
  }

  async function openViralTrendsPicker() {
    setShowViralTrendsPicker(true);
    setLoadingReadyTrendItems(true);
    loadPickerProducts();
    try {
      const res = await fetch("/api/viral-trends");
      const data = await res.json();
      const ready = (data.items ?? []).filter(
        (i: { readyForRemix: boolean }) => i.readyForRemix,
      );
      setReadyTrendItems(ready);
    } catch {
      setReadyTrendItems([]);
    } finally {
      setLoadingReadyTrendItems(false);
    }
  }

  function openUgcPicker() {
    setShowUgcPicker(true);
    loadPickerProducts();
    const live = ALL_PERSONAS.filter((p) => p.status === "live").map((p) => ({
      id: p.id,
      label: p.label,
      anchorPhoto: p.anchorPhoto,
    }));
    setUgcPersonas(live);
    if (live.length > 0) setSelectedPersonaId((prev) => prev || live[0].id);
  }

  function openProductAdPicker() {
    setShowProductAdPicker(true);
    loadPickerProducts();
  }

  // Replaces the old "Remix from skeletons" (which quietly pulled its top 5
  // from the auto-scraped pool) — up to 5 curated & ready Viral Trends
  // reels now (all of them if fewer than 5 exist), auto-picked rather than
  // admin-chosen one at a time — picking a single specific reel out of a
  // dropdown was real friction for no real benefit, confirmed by the
  // request to remove it. Same /api/remix/skeleton-matched route, just
  // with trendItemIds set to the whole ready batch instead of one id.
  async function handleRemixFromViralTrends(subject: {
    mode: "product" | "brand";
    productId?: string;
  }) {
    setRemixing(true);
    setError(null);
    const idsBefore = new Set(posts.map((p) => p.post.id));
    const trendItemIds = readyTrendItems.slice(0, 5).map((i) => i.id);
    try {
      const res = await fetch("/api/remix/skeleton-matched", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trendItemIds, ...subject }),
      });
      if (!res.ok) throw new Error(`remix failed (${res.status})`);
      // Up to 5 reels create up to 5 posts in the SAME Inngest run, not all
      // at once — confirmed live that breaking out as soon as the first
      // one appeared left the other 3-4 created but never render-triggered
      // (stuck pending until someone happened to open them individually or
      // reload the page). Keeps polling until the new-post count holds
      // steady across two checks in a row, so stragglers get counted too.
      let newPosts: RemixPost["post"][] = [];
      let prevCount = -1;
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const res2 = await fetch("/api/remixes");
        const data = await res2.json();
        const fresh = (data.posts ?? []) as RemixPost[];
        setPosts(fresh);
        window.dispatchEvent(new Event("review-queue-changed"));
        const found = fresh.filter((p) => !idsBefore.has(p.post.id));
        newPosts = found.map((p) => p.post);
        if (found.length > 0 && found.length === prevCount) break;
        prevCount = found.length;
      }
      if (newPosts.length > 0) {
        // format varies per reel (artifact_remix when it has uploaded
        // artifacts, runway_remix otherwise) — confirmed live this must
        // come from each actual created post, not be assumed, or an
        // artifact_remix post silently renders through the generic
        // persona pool instead of the reel's real uploaded artifacts.
        for (const p of newPosts) requestPersonaRender(p.id, p.format);
      } else {
        setError(
          "Those reels didn't produce a remix — try again, or check they still have a format/caption set.",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "remix failed");
    } finally {
      setRemixing(false);
    }
  }

  async function handleGenerateUgc(
    personaId: string,
    subject: { mode: "product" | "brand"; productId?: string },
  ) {
    setUgcGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/ugc/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaId, ...subject }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(
          data.error ?? `AI UGC generation failed (${res.status})`,
        );
      await loadPosts();
      window.dispatchEvent(new Event("review-queue-changed"));
      requestPersonaRender(data.postId, "runway_remix");
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI UGC generation failed");
    } finally {
      setUgcGenerating(false);
    }
  }

  async function handleGenerateProductAd(productId: string) {
    setProductAdGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/product-ads/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(
          data.error ?? `product ad generation failed (${res.status})`,
        );
      await loadPosts();
      window.dispatchEvent(new Event("review-queue-changed"));
      setProductAdGenerating(false);

      requestedRunway.current.add(data.postId);
      fetch(`/api/product-ads/${data.postId}/render`, { method: "POST" })
        .then(async (renderRes) => {
          const renderData = await renderRes.json().catch(() => ({}));
          if (!renderRes.ok)
            throw new Error(
              renderData.error ??
                `product ad render failed (${renderRes.status})`,
            );
          setRunwayUrls((prev) => ({
            ...prev,
            [data.postId]: renderData.renderedFileUrl,
          }));
          setPosts((prev) =>
            prev.map((p) =>
              p.post.id === data.postId
                ? {
                    ...p,
                    post: {
                      ...p.post,
                      renderedFileUrl: renderData.renderedFileUrl,
                    },
                  }
                : p,
            ),
          );
          window.dispatchEvent(new Event("review-queue-changed"));
        })
        .catch((e) => {
          setRunwayErrors((prev) => ({
            ...prev,
            [data.postId]:
              e instanceof Error ? e.message : "product ad render failed",
          }));
        });
    } catch (e) {
      setError(e instanceof Error ? e.message : "product ad generation failed");
      setProductAdGenerating(false);
    }
  }

  const decide = useCallback(
    async (status: "kept" | "discarded") => {
      if (!selected || acting) return;
      setActing(true);
      const { post } = selected;
      await fetch(`/api/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          format:
            post.format === "runway_remix"
              ? "persona_remix"
              : post.format === "artifact_remix"
                ? "artifact_remix"
                : undefined,
        }),
      });
      // Updates status in place — never removed from the gallery. This is
      // the actual behavior change from the old "Review" model, where
      // deciding made a post vanish; the real ask was to retain everything.
      setPosts((prev) =>
        prev.map((p) =>
          p.post.id === post.id ? { ...p, post: { ...p.post, status } } : p,
        ),
      );
      setActing(false);
      window.dispatchEvent(new Event("review-queue-changed"));
    },
    [selected, acting],
  );

  // Two clicks, not window.confirm — first click arms it ("Delete?"),
  // second click on the same card actually deletes. Only this one remix:
  // the source reel and any other remix made from it are untouched (see
  // DELETE /api/posts/[id]'s own comment).
  async function deletePost(postId: string) {
    if (confirmDeleteId !== postId) {
      setConfirmDeleteId(postId);
      return;
    }
    setConfirmDeleteId(null);
    setPosts((prev) => prev.filter((p) => p.post.id !== postId));
    if (selectedId === postId) setSelectedId(null);
    await fetch(`/api/posts/${postId}`, { method: "DELETE" }).catch(() => {});
  }

  function flip() {
    if (!selected) return;
    const total = selected.script.slides?.length ?? 1;
    setSlideIndex((i) => (i + 1) % total);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (editing || !selectedId) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") setSelectedId(null);
      else if (e.key === "ArrowLeft") decide("discarded");
      else if (e.key === "ArrowRight") decide("kept");
      else if (e.key === " ") {
        e.preventDefault();
        flip();
      } else if (e.key === "e" || e.key === "E") setEditing(true);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editing, selectedId, decide, selected]);

  function openDetail(postId: string) {
    setSelectedId(postId);
    setSlideIndex(0);
    setShowWhy(false);
    setConfirmDeleteId(null);
  }

  function handleSaved(
    scriptId: string,
    updated: Partial<RemixPost["script"]>,
  ) {
    setPosts((prev) =>
      prev.map((p) =>
        p.script.id === scriptId
          ? { ...p, script: { ...p.script, ...updated } }
          : p,
      ),
    );
    setSlideIndex(0);
  }

  const counts = {
    all: posts.length,
    pending: posts.filter((p) => p.post.status === "pending").length,
    kept: posts.filter((p) => p.post.status === "kept").length,
    discarded: posts.filter((p) => p.post.status === "discarded").length,
  };
  // Which platforms actually appear in the loaded data — avoids showing an
  // empty filter chip for a source nothing was ever remixed from.
  const sourcesPresent = Array.from(
    new Set(posts.map((p) => p.trendItem.platform)),
  ).sort();
  const sourceCounts: Record<string, number> = { all: posts.length };
  for (const s of sourcesPresent)
    sourceCounts[s] = posts.filter((p) => p.trendItem.platform === s).length;

  const filtered = posts
    .filter((p) => statusFilter === "all" || p.post.status === statusFilter)
    .filter(
      (p) => sourceFilter === "all" || p.trendItem.platform === sourceFilter,
    )
    .sort((a, b) => {
      const diff =
        new Date(b.post.createdAt).getTime() -
        new Date(a.post.createdAt).getTime();
      return sortOrder === "newest" ? diff : -diff;
    });

  return (
    <div className="page-wide">
      <PageHeader
        title="All Creatives"
        subtitle={
          loading
            ? "Loading..."
            : posts.length +
              " creatives / " +
              counts.pending +
              " awaiting review"
        }
        actions={
          <button className="btn" onClick={() => setShowOnboarding(true)}>
            <RefreshCw aria-hidden="true" />
            Refresh trends
          </button>
        }
      />
      <div className="create-mode-grid">
        <button
          className="create-mode-card"
          onClick={openViralTrendsPicker}
          disabled={remixing}
        >
          <span className="create-mode-kicker">
            <Shuffle aria-hidden="true" />
            Trend remix
          </span>
          <span className="create-mode-title">Remix Viral Trends</span>
          <span className="create-mode-copy">
            {remixing
              ? "Creating remix queue…"
              : "Turn curated reels into brand posts"}
          </span>
        </button>
        <button
          className="create-mode-card"
          onClick={openUgcPicker}
          disabled={ugcGenerating}
        >
          <span className="create-mode-kicker">
            <Users aria-hidden="true" />
            Persona UGC
          </span>
          <span className="create-mode-title">Generate AI UGC</span>
          <span className="create-mode-copy">
            {ugcGenerating
              ? "Creating persona clip…"
              : "Use a saved creator persona"}
          </span>
        </button>
        <button
          className="create-mode-card create-mode-card-strong"
          onClick={openProductAdPicker}
          disabled={productAdGenerating}
        >
          <span className="create-mode-kicker">
            <Package aria-hidden="true" />
            Product UGC
          </span>
          <span className="create-mode-title">Generate Product UGC</span>
          <span className="create-mode-copy">
            {productAdGenerating
              ? "Creating in-progress tile…"
              : "Animate the product itself"}
          </span>
        </button>
      </div>

      {showOnboarding && (
        <OnboardingScreen
          onDone={async () => {
            setShowOnboarding(false);
            setLoading(true);
            await loadPosts();
          }}
        />
      )}

      {/* Subject picker (brand-vs-product radio) is identical for both
       * workflows below — only what sits above it differs (a reel to pick
       * vs. a persona to pick). */}
      {showViralTrendsPicker && (
        <div
          className="modal-backdrop"
          onClick={() => setShowViralTrendsPicker(false)}
        >
          <div
            className="remix-picker-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <div className="modal-title">Remix from Viral Trends</div>
              <button
                className="modal-close"
                onClick={() => setShowViralTrendsPicker(false)}
                aria-label="Close"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="modal-sub">
              {loadingReadyTrendItems
                ? "Loading curated reels…"
                : readyTrendItems.length === 0
                  ? "No curated reels are ready yet — go to Trends and mark one ready (needs at least one uploaded artifact) first."
                  : `Fills copy for your ${Math.min(readyTrendItems.length, 5)} curated & ready reel${Math.min(readyTrendItems.length, 5) === 1 ? "" : "s"}, grounded in each one's real on-screen hook.`}
            </div>

            <label className="remix-picker-option" style={{ marginTop: 14 }}>
              <input
                type="radio"
                checked={remixMode === "product"}
                onChange={() => setRemixMode("product")}
              />
              <span>A specific product</span>
            </label>
            {remixMode === "product" && (
              <select
                className="remix-picker-select"
                value={remixProductId}
                onChange={(e) => setRemixProductId(e.target.value)}
                disabled={loadingPickerProducts || pickerProducts.length === 0}
              >
                {loadingPickerProducts && <option>Loading products…</option>}
                {!loadingPickerProducts && pickerProducts.length === 0 && (
                  <option>No products in catalog</option>
                )}
                {pickerProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            )}

            <label className="remix-picker-option">
              <input
                type="radio"
                checked={remixMode === "brand"}
                onChange={() => setRemixMode("brand")}
              />
              <span>{brand.name} in general</span>
            </label>

            <div className="modal-footer">
              <div />
              <button
                className="btn btn-pri"
                disabled={
                  remixing ||
                  readyTrendItems.length === 0 ||
                  (remixMode === "product" && !remixProductId)
                }
                onClick={() => {
                  setShowViralTrendsPicker(false);
                  handleRemixFromViralTrends(
                    remixMode === "product"
                      ? { mode: "product", productId: remixProductId }
                      : { mode: "brand" },
                  );
                }}
              >
                Remix
              </button>
            </div>
          </div>
        </div>
      )}

      {showUgcPicker && (
        <div className="modal-backdrop" onClick={() => setShowUgcPicker(false)}>
          <div
            className="remix-picker-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <div className="modal-title">Generate AI UGC</div>
              <button
                className="modal-close"
                onClick={() => setShowUgcPicker(false)}
                aria-label="Close"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="modal-sub">
              Picks an AI persona from the Persona Library to front a
              talking-style ad — no sourced reel needed.
            </div>

            <div
              className="modal-sub"
              style={{
                fontWeight: 700,
                color: "var(--foreground)",
                marginBottom: 6,
              }}
            >
              Choose a persona
            </div>
            <div className="ugc-persona-grid">
              {ugcPersonas.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={
                    selectedPersonaId === p.id
                      ? "ugc-persona-card active"
                      : "ugc-persona-card"
                  }
                  onClick={() => setSelectedPersonaId(p.id)}
                >
                  <img src={`/${p.anchorPhoto}`} alt={p.label} />
                  <span>{p.label}</span>
                </button>
              ))}
            </div>

            <label className="remix-picker-option" style={{ marginTop: 14 }}>
              <input
                type="radio"
                checked={remixMode === "product"}
                onChange={() => setRemixMode("product")}
              />
              <span>A specific product</span>
            </label>
            {remixMode === "product" && (
              <select
                className="remix-picker-select"
                value={remixProductId}
                onChange={(e) => setRemixProductId(e.target.value)}
                disabled={loadingPickerProducts || pickerProducts.length === 0}
              >
                {loadingPickerProducts && <option>Loading products…</option>}
                {!loadingPickerProducts && pickerProducts.length === 0 && (
                  <option>No products in catalog</option>
                )}
                {pickerProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            )}

            <label className="remix-picker-option">
              <input
                type="radio"
                checked={remixMode === "brand"}
                onChange={() => setRemixMode("brand")}
              />
              <span>{brand.name} in general</span>
            </label>

            <div className="modal-footer">
              <div />
              <button
                className="btn btn-pri"
                disabled={
                  ugcGenerating ||
                  !selectedPersonaId ||
                  (remixMode === "product" && !remixProductId)
                }
                onClick={() => {
                  setShowUgcPicker(false);
                  handleGenerateUgc(
                    selectedPersonaId,
                    remixMode === "product"
                      ? { mode: "product", productId: remixProductId }
                      : { mode: "brand" },
                  );
                }}
              >
                Generate
              </button>
            </div>
          </div>
        </div>
      )}
      {showProductAdPicker && (
        <div
          className="modal-backdrop"
          onClick={() => setShowProductAdPicker(false)}
        >
          <div
            className="remix-picker-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <div className="modal-title">Generate Product UGC</div>
              <button
                className="modal-close"
                onClick={() => setShowProductAdPicker(false)}
                aria-label="Close"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="modal-sub">Runway Gen-4.5 / Product image</div>

            <select
              className="remix-picker-select"
              value={remixProductId}
              onChange={(e) => setRemixProductId(e.target.value)}
              disabled={loadingPickerProducts || pickerProducts.length === 0}
              style={{ marginTop: 14 }}
            >
              {loadingPickerProducts && <option>Loading products…</option>}
              {!loadingPickerProducts && pickerProducts.length === 0 && (
                <option>No products in catalog</option>
              )}
              {pickerProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>

            <div className="modal-footer">
              <div />
              <button
                className="btn btn-pri"
                disabled={productAdGenerating || !remixProductId}
                onClick={() => {
                  setShowProductAdPicker(false);
                  handleGenerateProductAd(remixProductId);
                }}
              >
                Generate
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="empty-state" style={{ color: "var(--fail)" }}>
          {error}
        </div>
      )}

      {/* Status + sort share one row (sort pinned to the right via
       * margin-left:auto) — confirmed live 3 stacked full-width rows for
       * what's really 2 independent filter dimensions plus a sort toggle
       * read as too tall/heavy. Source filter stays its own row: it's
       * conditional (only appears once Viral Trends contributes a second
       * source) and its own dimension, not naturally paired with either. */}
      <div className="rmx-filters">
        {(["all", "pending", "kept", "discarded"] as StatusFilter[]).map(
          (f) => (
            <button
              key={f}
              className={
                statusFilter === f ? "rmx-filter active" : "rmx-filter"
              }
              onClick={() => setStatusFilter(f)}
            >
              {f[0].toUpperCase() + f.slice(1)}{" "}
              <span className="rmx-filter-count">{counts[f]}</span>
            </button>
          ),
        )}
        <div className="rmx-filters-sort">
          <button
            className={
              sortOrder === "newest" ? "rmx-filter active" : "rmx-filter"
            }
            onClick={() => setSortOrder("newest")}
          >
            Newest
          </button>
          <button
            className={
              sortOrder === "oldest" ? "rmx-filter active" : "rmx-filter"
            }
            onClick={() => setSortOrder("oldest")}
          >
            Oldest
          </button>
        </div>
      </div>

      {/* Separate dimension from status — which pipeline a remix's source
       * reel came from (Viral Trends' manual_viral vs the auto-scrape
       * platforms). Only shown once there's more than one real source to
       * distinguish between. */}
      {sourcesPresent.length > 1 && (
        <div className="rmx-filters">
          <button
            className={
              sourceFilter === "all" ? "rmx-filter active" : "rmx-filter"
            }
            onClick={() => setSourceFilter("all")}
          >
            All sources{" "}
            <span className="rmx-filter-count">{sourceCounts.all}</span>
          </button>
          {sourcesPresent.map((s) => (
            <button
              key={s}
              className={
                sourceFilter === s ? "rmx-filter active" : "rmx-filter"
              }
              onClick={() => setSourceFilter(s)}
            >
              {SOURCE_LABELS[s] ?? s}{" "}
              <span className="rmx-filter-count">{sourceCounts[s]}</span>
            </button>
          ))}
        </div>
      )}

      {!loading && filtered.length === 0 && !error && (
        <div className="empty-state">
          {posts.length === 0
            ? "No creatives yet."
            : `No ${statusFilter} posts.`}
        </div>
      )}

      <MediaGrid>
        {filtered.map(({ post, script, trendItem }) => {
          const background = "var(--panel-2)";
          // Not-yet-rendered posts used to fall back to the ORIGINAL source
          // video (with the generated headline overlaid on top) — confirmed
          // live this made a pending card look like a finished, hoverable
          // remix. Only a real rendered persona video counts as a preview.
          const pending = !post.renderedFileUrl;
          const rendering =
            requestedRunway.current.has(post.id) && !runwayErrors[post.id];
          return (
            <div
              className="frame rmx-card"
              key={post.id}
              onClick={() => openDetail(post.id)}
              onMouseEnter={() => !pending && setHoveredCardId(post.id)}
              onMouseLeave={() =>
                setHoveredCardId((cur) => (cur === post.id ? null : cur))
              }
              style={{ cursor: "pointer" }}
            >
              <div className="fbar">
                <div className={`rmx-status-dot rmx-status-${post.status}`} />
                <div
                  className="fdot"
                  style={{ background: "rgba(255,255,255,.12)" }}
                />
                <div className="ftit">
                  {SOURCE_LABELS[trendItem.platform] ?? trendItem.platform} /{" "}
                  {trendItem.handle ?? "Unknown"}
                </div>
                {/* Only once a real rendered file exists — shareOrDownload
                 * needs an actual video to fetch, and a still-pending card
                 * has nothing to share yet. Right here instead of gated
                 * behind Keep → Exports, so you don't have to decide first
                 * just to grab the file. */}
                {!pending && (
                  <button
                    className="rmx-share-btn"
                    style={{ marginLeft: "auto" }}
                    title="Share / Download"
                    disabled={sharingId === post.id}
                    onClick={async (e) => {
                      e.stopPropagation();
                      setSharingId(post.id);
                      await shareOrDownload(
                        post.renderedFileUrl!,
                        script.hook ?? "GloVibe remix",
                      );
                      setSharingId(null);
                    }}
                  >
                    <Share2 size={14} aria-hidden="true" />
                  </button>
                )}
                <button
                  className="btn btn-sm"
                  style={{
                    marginLeft: pending ? "auto" : undefined,
                    ...(confirmDeleteId === post.id
                      ? { color: "var(--fail)", borderColor: "var(--fail)" }
                      : undefined),
                  }}
                  title={
                    confirmDeleteId === post.id
                      ? "Click again to permanently delete this remix"
                      : "Delete this remix"
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    deletePost(post.id);
                  }}
                >
                  {confirmDeleteId === post.id ? (
                    "Delete?"
                  ) : (
                    <Trash2 size={14} aria-hidden="true" />
                  )}
                </button>
              </div>
              <div
                className={pending ? "rmx-thumb rmx-thumb-draft" : "rmx-thumb"}
                style={{ background }}
              >
                {pending ? (
                  <div className="rmx-thumb-pending">
                    {runwayErrors[post.id] ? (
                      <span
                        className="rmx-thumb-pending-label"
                        style={{ color: "var(--fail)" }}
                      >
                        {runwayErrors[post.id]} — tap to retry
                      </span>
                    ) : (
                      <>
                        {rendering ? (
                          <div className="rc-render-spinner" />
                        ) : (
                          <FileVideo size={26} aria-hidden="true" />
                        )}
                        <span className="rmx-thumb-pending-label">
                          {rendering ? "Rendering..." : "Storyboard ready"}
                        </span>
                        <strong className="rmx-draft-title">
                          {script.hook ?? "Untitled creative"}
                        </strong>
                      </>
                    )}
                  </div>
                ) : (
                  <>
                    {hoveredCardId === post.id ? (
                      <video
                        className="rmx-thumb-video"
                        src={post.renderedFileUrl!}
                        autoPlay
                        muted
                        loop
                        playsInline
                        preload="metadata"
                      />
                    ) : (
                      !posterFailed[post.id] && (
                        <img
                          className="rmx-thumb-video"
                          src={`/storage/rendered-posts/${post.id}-poster.jpg`}
                          alt=""
                          loading="lazy"
                          onError={() =>
                            setPosterFailed((p) => ({ ...p, [post.id]: true }))
                          }
                        />
                      )
                    )}
                    <div className="rmx-thumb-scrim" />
                    <div className="rmx-thumb-headline">
                      {script.hook ?? "(no hook)"}
                    </div>
                    {script.angle && (
                      <div className="rc-angle">{script.angle}</div>
                    )}
                  </>
                )}
                <span className={`status-pill ${post.status}`}>
                  {post.status}
                </span>
              </div>
              <div className="cl-card-body">
                {trendItem.viewCount != null && (
                  <div className="cl-views" style={{ marginBottom: 6 }}>
                    {compactCount(trendItem.viewCount)} plays
                  </div>
                )}
                {script.hookType && (
                  <div className="cl-skeletons" style={{ marginBottom: 0 }}>
                    <span className="cl-skeleton">
                      {script.hookType === "brand_feed_remix"
                        ? "Brand remix"
                        : script.hookType === "product_edit"
                          ? "Product video"
                          : script.hookType.replace(/_/g, " ")}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </MediaGrid>

      {selected && (
        <div className="modal-backdrop" onClick={() => setSelectedId(null)}>
          <div className="rmx-detail" onClick={(e) => e.stopPropagation()}>
            <div className="rmx-detail-head">
              <span className={`status-pill ${selected.post.status}`}>
                {selected.post.status}
              </span>
              <button
                className="modal-close"
                onClick={() => setSelectedId(null)}
                aria-label="Close"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="rc-stage">
              <div className="rc-hero">
                {currentRunwayUrl ? (
                  <div className="phone">
                    <div className="pnotch" />
                    <video
                      key={currentRunwayUrl}
                      src={currentRunwayUrl}
                      controls
                    />
                  </div>
                ) : selected.post.format === "runway_remix" ||
                  selected.post.format === "artifact_remix" ? (
                  // Not the ReviewCard text-slide layout — that looks like a
                  // finished result, and showing it while the real video is
                  // still assembling was genuinely misleading (flagged
                  // directly). This dashed placeholder can't be mistaken
                  // for output.
                  <div className="rc-render-loading">
                    {runwayErrors[selected.post.id] ? (
                      <span
                        className="rc-render-loading-text"
                        style={{ color: "var(--fail)" }}
                      >
                        {runwayErrors[selected.post.id]}
                      </span>
                    ) : (
                      <>
                        <div className="rc-render-spinner" />
                        <span className="rc-render-loading-text">
                          {selected.trendItem.platform === "local_upload"
                            ? "Generating product ad…"
                            : "Assembling persona-library remix… $0, usually under a minute — but the first one after a server restart builds the renderer from scratch and can take up to 4 minutes."}
                        </span>
                      </>
                    )}
                  </div>
                ) : (
                  <ReviewCard
                    post={selected}
                    slideIndex={slideIndex}
                    onFlip={setSlideIndex}
                  />
                )}
                <span className="rc-hero-badge">Your remix</span>
              </div>

              {/* Picture-in-picture, not a co-equal panel — hidden for product ads because there is no source reel. */}
              {selected.trendItem.platform !== "local_upload" &&
                selected.trendItem.sourceUrl && (
                  <div className="rc-pip">
                    <div className="rc-pip-chrome">
                      <span className="rc-pip-dot" />
                      <span className="rc-pip-dot rc-pip-dot-2" />
                      <span className="rc-pip-handle">
                        {selected.trendItem.platform.toUpperCase()} · @
                        {selected.trendItem.handle ?? "unknown"}
                      </span>
                    </div>
                    <div className="rc-pip-body">
                      {selected.trendItem.platform === "manual_viral" ? (
                        isInstagramUrl(selected.trendItem.sourceUrl) ? (
                          <div className="rc-pip-ig-wrap">
                            <InstagramEmbed
                              key={selected.trendItem.sourceUrl}
                              permalink={selected.trendItem.sourceUrl}
                            />
                          </div>
                        ) : (
                          <div className="rc-pip-loading">
                            <span>Can&apos;t embed this one.</span>
                          </div>
                        )
                      ) : currentOriginalUrl ? (
                        <video
                          key={currentOriginalUrl}
                          src={currentOriginalUrl}
                          controls
                        />
                      ) : (
                        <div className="rc-pip-loading">
                          {fetchingOriginal ? (
                            <span>Fetching…</span>
                          ) : originalError ? (
                            <span style={{ color: "var(--fail)" }}>
                              {originalError}
                            </span>
                          ) : (
                            <span>—</span>
                          )}
                        </div>
                      )}
                    </div>
                    <span className="rc-pip-label">Source reel</span>
                  </div>
                )}
            </div>

            {/*
             * Both this disclaimer and the upgrade button below only make
             * sense for the legacy scraped-trend Runway pipeline, where a
             * free persona-library clip (suffix "-persona.mp4") is a
             * placeholder you can pay to upgrade to a real per-beat Runway
             * render (suffix "-runway.mp4"). An artifact_remix's video is
             * the admin's own real, final, curated footage — there is no
             * "mock" version and nothing to upgrade to. Confirmed live: this
             * used to show for artifact_remix too (the old check only
             * looked at the filename suffix, and "-artifact.mp4" isn't
             * "-runway.mp4" either), and the button would silently
             * overwrite a working artifact remix by calling
             * generate-runway with a hardcoded, unrelated product photo.
             */}
            {mockMode &&
              selected.post.format !== "artifact_remix" &&
              selected.trendItem.platform !== "local_upload" && (
                <div
                  className="rc-runway-status"
                  style={{ maxWidth: 340, margin: "0 auto" }}
                >
                  Mock preview — real footage this project already paid to
                  download, but not necessarily THIS post&apos;s real reel. Only
                  MOCK_MODE=false guarantees a real match.
                </div>
              )}
            {currentRunwayUrl &&
              selected.post.format !== "artifact_remix" &&
              selected.trendItem.platform !== "local_upload" &&
              !currentRunwayUrl.endsWith("-runway.mp4") && (
                <button
                  className="btn btn-sm"
                  style={{
                    marginTop: 8,
                    maxWidth: 340,
                    width: "100%",
                    marginLeft: "auto",
                    marginRight: "auto",
                    display: "block",
                  }}
                  onClick={handleGenerateRealAi}
                  disabled={generatingRealAi}
                >
                  {generatingRealAi
                    ? "Generating…"
                    : mockMode
                      ? "Generate real AI video (mock, free)"
                      : "Generate real AI video (Runway, $2–8)"}
                </button>
              )}

            {showWhy && (
              <div className="term rc-why">
                <div
                  style={{
                    color: "var(--faint)",
                    fontSize: 9,
                    letterSpacing: "0.14em",
                    marginBottom: 7,
                  }}
                >
                  WHY THIS POST
                </div>
                {selected.post.score != null && (
                  <div>
                    <span className="tc">score:</span>{" "}
                    <span className="ty">{selected.post.score}</span>
                  </div>
                )}
                {selected.script.hookType &&
                SKELETONS[selected.script.hookType as SkeletonId]
                  ? (() => {
                      const sk =
                        SKELETONS[selected.script.hookType as SkeletonId];
                      return (
                        <>
                          <div style={{ marginBottom: 6 }}>
                            <span className="tc">format:</span>{" "}
                            <span className="ty">{sk.name}</span>
                          </div>
                          <div style={{ marginBottom: 6 }}>
                            <span className="tc">why this format:</span>{" "}
                            <span className="ty">
                              mined from {sk.evidence.instances} real posts by{" "}
                              {sk.evidence.creators} different creators (
                              {Math.round(sk.evidence.independenceRatio * 100)}%
                              independent reinvention — not one account
                              repeating it),{" "}
                              {compactCount(sk.evidence.totalPlays)} combined
                              plays
                            </span>
                          </div>
                          {sk.evidence.examples[0] && (
                            <div style={{ marginBottom: 6 }}>
                              <span className="tc">real example:</span>{" "}
                              <span className="ty">
                                &quot;{sk.evidence.examples[0]}&quot;
                              </span>
                            </div>
                          )}
                        </>
                      );
                    })()
                  : selected.script.hookType && (
                      <div style={{ marginBottom: 6 }}>
                        <span className="tc">skeleton:</span>{" "}
                        <span className="ty">
                          &quot;{selected.script.hookType}&quot;
                        </span>
                      </div>
                    )}
                {selected.script.tags?.[0] && (
                  <div style={{ marginBottom: 6 }}>
                    <span className="tc">grounded in:</span>{" "}
                    <span className="ty">{selected.script.tags[0]}</span>
                  </div>
                )}
                <div>
                  <span className="tc">source reel:</span>{" "}
                  <span className="ty">
                    {selected.trendItem.platform} · @
                    {selected.trendItem.handle ?? "unknown"}
                    {selected.trendItem.viewCount != null &&
                      ` · ${compactCount(selected.trendItem.viewCount)} plays`}
                  </span>
                </div>
              </div>
            )}

            <div className="rc-actions">
              {currentRunwayUrl && selected.post.status !== "discarded" && (
                <Link
                  className="rc-btn de-promote-link"
                  href={"/drive-engagement?postId=" + selected.post.id}
                >
                  <Megaphone size={16} />
                  Drive engagement
                </Link>
              )}
              <button
                className="rc-btn rc-btn-fail"
                onClick={() => decide("discarded")}
                disabled={acting}
              >
                ← Pass
              </button>
              <button className="rc-btn" onClick={() => setShowWhy((w) => !w)}>
                Why this?
              </button>
              <button className="rc-btn" onClick={() => setEditing(true)}>
                Edit
              </button>
              <button
                className="rc-btn rc-btn-pass"
                onClick={() => decide("kept")}
                disabled={acting}
              >
                {acting ? "…" : "Keep →"}
              </button>
            </div>
            <div className="rc-shortcuts">
              <kbd>esc</kbd> close · <kbd>←</kbd> <kbd>→</kbd> decide ·{" "}
              <kbd>space</kbd> flip · <kbd>e</kbd> edit
            </div>
          </div>
        </div>
      )}

      {editing && selected && (
        <EditModal
          script={selected.script}
          canRegenerate={
            selected.trendItem.platform !== "local_upload" &&
            (selected.post.format === "runway_remix" ||
              selected.post.format === "artifact_remix")
          }
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            handleSaved(selected.script.id, updated);
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}

function ReviewCard({
  post: { post, script, trendItem },
  slideIndex,
  onFlip,
}: {
  post: RemixPost;
  slideIndex: number;
  onFlip: (i: number) => void;
}) {
  const slides = script.slides?.length
    ? script.slides
    : [script.hook ?? "(no hook)"];
  const clampedIndex = Math.min(slideIndex, slides.length - 1);
  const background = "var(--panel-2)";

  return (
    <div className="rc-card" style={{ background }}>
      <div className="rc-progress">
        {slides.map((_, i) => (
          <button
            key={i}
            className="rc-progress-seg"
            onClick={() => onFlip(i)}
            aria-label={`Slide ${i + 1}`}
          >
            <span
              className={
                i <= clampedIndex
                  ? "rc-progress-fill filled"
                  : "rc-progress-fill"
              }
            />
          </button>
        ))}
      </div>
      {post.score != null && <div className="rc-score">{post.score}</div>}
      <div className="rc-headline">{slides[clampedIndex]}</div>
      {script.angle && <div className="rc-angle">{script.angle}</div>}
    </div>
  );
}
