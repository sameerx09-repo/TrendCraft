"use client";
import { PageHeader } from "../PageHeader";
import {
  Plus,
  Trash2,
  X,
  Play,
  ArrowUpRight,
  Shuffle,
  Clapperboard,
} from "lucide-react";

import { useEffect, useState } from "react";
import { useBrand } from "../BrandSession";
import { InstagramEmbed, useInstagramEmbedScript } from "../InstagramEmbed";
import { SKELETONS } from "@/lib/render/skeletonLibrary";
import { MediaGrid } from "../MediaGrid";

function isInstagramUrl(url: string): boolean {
  return url.includes("instagram.com");
}

/** Trend Feed (the old /content-library) merged in here as a read-only,
 * filterable second row — same data, same API, just presented alongside
 * the curated/manual reels instead of on its own separate page. Kept as
 * its own copy of the small helpers (same convention as Generate Content's
 * identical gradientFor/compactCount — see that page's own comment) rather
 * than a shared import, so this page stays decoupled from content-library's
 * now-retired page component. */
interface AutoDiscoveredItem {
  id: string;
  platform: string;
  handle: string | null;
  title: string | null;
  sourceUrl: string;
  thumbnailUrl: string | null;
  hookLine: string | null;
  matchedSkeletons: string[] | null;
  viewCount: number | null;
  remixCount: number;
}

function compactCount(n: number): string {
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function youTubeEmbedUrl(url: string): string | null {
  const m = url.match(/(?:v=|youtu\.be\/|\/shorts\/)([\w-]{6,})/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
}

type TrendsFilter = "all" | "curated" | "auto";

interface Artifact {
  id: string;
  label: string;
  fileUrl: string | null;
  status: "needed" | "uploaded";
}

interface ViralTrendItem {
  id: string;
  sourceUrl: string;
  handle: string | null;
  caption: string | null;
  hookLine: string | null;
  matchedSkeletons: string[] | null;
  readyForRemix: boolean;
  artifacts: Artifact[] | null;
  scrapedAt: string;
  sourceVideoUrl: string | null;
  thumbnailUrl: string | null;
}

interface Product {
  id: string;
  title: string;
}

/** Admin-only for now — no auth/role system exists in this app yet (see
 * lib/db/schema.ts's "auth is parked" note). All of import/artifact-manage/
 * mark-ready is shown to every viewer; the real enforcement (never remixing
 * a not-ready reel) lives server-side in remixSkeletonMatchedItems, so this
 * being UI-only doesn't create a real gap — it's just not role-restricted
 * yet. Wrap these controls in a role check once one exists. */
export default function ViralTrendsPage() {
  const [items, setItems] = useState<ViralTrendItem[]>([]);
  const [autoItems, setAutoItems] = useState<AutoDiscoveredItem[]>([]);
  const [autoLoading, setAutoLoading] = useState(true);
  const [autoPlayingId, setAutoPlayingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<TrendsFilter>("all");
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [remixId, setRemixId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // A transient balloon, not a dialog you dismiss yourself — confirmed
  // annoying live: the remix-picker used to stay open after a successful
  // trigger with a success line appended below the button, so it looked
  // like nothing had happened until you noticed the tiny text and closed
  // it yourself. Auto-clears after a few seconds; a new one replaces
  // whatever's showing rather than stacking.
  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast((cur) => (cur === message ? null : cur)), 3500);
  }

  useInstagramEmbedScript();

  function reload() {
    setLoading(true);
    fetch("/api/viral-trends")
      .then((r) => r.json())
      .then((data) => {
        setItems(data.items ?? []);
        setLoading(false);
      });
  }

  useEffect(() => {
    fetch("/api/viral-trends")
      .then((r) => r.json())
      .then((data) => {
        setItems(data.items ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    fetch("/api/products")
      .then((r) => r.json())
      .then((data) =>
        setProducts(
          (data.items ?? []).map((p: { id: string; title: string }) => ({
            id: p.id,
            title: p.title,
          })),
        ),
      );
    fetch("/api/content-library?sort=match")
      .then((r) => r.json())
      .then((data) => {
        setAutoItems(data.items ?? []);
        setAutoLoading(false);
      })
      .catch(() => setAutoLoading(false));
  }, []);

  // Two clicks, not window.confirm — first click arms it ("Delete?"),
  // second click on the same card actually deletes. Removes the reel, every
  // remix ever made from it, and its uploaded artifact/source-video files
  // (see the route's own comment on why this reel is the one real
  // exception to trendItems' otherwise permanent, append-only design).
  async function deleteItem(id: string) {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    setConfirmDeleteId(null);
    setItems((prev) => prev.filter((i) => i.id !== id));
    await fetch(`/api/viral-trends/${id}`, { method: "DELETE" }).catch(
      () => {},
    );
  }

  const detailItem = items.find((i) => i.id === detailId) ?? null;
  const remixItem = items.find((i) => i.id === remixId) ?? null;

  const showCurated = filter === "all" || filter === "curated";
  const showAuto = filter === "all" || filter === "auto";

  return (
    <div className="page-wide">
      <PageHeader
        title="Trends"
        subtitle={
          items.length + " curated reels / " + autoItems.length + " discovered"
        }
        actions={
          <button className="btn btn-pri" onClick={() => setShowImport(true)}>
            <Plus aria-hidden="true" />
            Import reels
          </button>
        }
      />
      {/* The one real distinction this merge needs — Trend Feed and Viral
          Trends used to be two separate pages with no shared filter, so
          there was no way to see "everything" or compare counts at a
          glance. */}
      <div className="trends-filter-tabs">
        <button
          className={filter === "all" ? "trends-tab active" : "trends-tab"}
          onClick={() => setFilter("all")}
        >
          All · {items.length + autoItems.length}
        </button>
        <button
          className={filter === "curated" ? "trends-tab active" : "trends-tab"}
          onClick={() => setFilter("curated")}
        >
          Curated · {items.length}
        </button>
        <button
          className={filter === "auto" ? "trends-tab active" : "trends-tab"}
          onClick={() => setFilter("auto")}
        >
          Auto-discovered · {autoItems.length}
        </button>
      </div>

      {showCurated && (
        <>
          {!loading && items.length === 0 && (
            <div className="empty-state">
              No manually-sourced reels yet — click &ldquo;Import reels&rdquo;
              to add some.
            </div>
          )}
          {items.length > 0 && filter === "all" && (
            <div className="netflix-row-heading">Curated reels</div>
          )}
          {items.length > 0 && (
            <MediaGrid>
              {items.map((item) => (
                <ViralTrendCard
                  key={item.id}
                  item={item}
                  onOpen={() => {
                    setConfirmDeleteId(null);
                    setDetailId(item.id);
                  }}
                  onRemix={() => {
                    setConfirmDeleteId(null);
                    setRemixId(item.id);
                  }}
                  onDelete={() => deleteItem(item.id)}
                  confirmingDelete={confirmDeleteId === item.id}
                />
              ))}
            </MediaGrid>
          )}
        </>
      )}

      {showAuto && (
        <>
          {filter === "auto" && !autoLoading && autoItems.length === 0 && (
            <div className="empty-state">Nothing auto-discovered yet.</div>
          )}
          {autoItems.length > 0 && filter === "all" && (
            <div
              className="netflix-row-heading"
              style={{ marginTop: showCurated && items.length > 0 ? 24 : 0 }}
            >
              Auto-discovered
            </div>
          )}
          {autoItems.length > 0 && (
            <MediaGrid>
              {autoItems.map((item) => (
                <AutoDiscoveredCard
                  key={item.id}
                  item={item}
                  playingId={autoPlayingId}
                  setPlayingId={setAutoPlayingId}
                />
              ))}
            </MediaGrid>
          )}
        </>
      )}

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={() => {
            reload();
            setShowImport(false);
          }}
        />
      )}

      {detailItem && (
        <DetailModal
          item={detailItem}
          onClose={() => setDetailId(null)}
          onChanged={reload}
        />
      )}

      {remixItem && (
        <RemixModal
          item={remixItem}
          products={products}
          onClose={() => setRemixId(null)}
          onChanged={reload}
          onRemixed={(message) => {
            setRemixId(null);
            showToast(message);
          }}
        />
      )}

      {toast && <div className="toast-balloon">{toast}</div>}
    </div>
  );
}

function ViralTrendCard({
  item,
  onOpen,
  onRemix,
  onDelete,
  confirmingDelete,
}: {
  item: ViralTrendItem;
  onOpen: () => void;
  onRemix: () => void;
  onDelete: () => void;
  confirmingDelete: boolean;
}) {
  const artifacts = item.artifacts ?? [];
  const uploadedCount = artifacts.filter((a) => a.status === "uploaded").length;

  return (
    <div className="frame cl-card">
      <div className="fbar" onClick={onOpen} style={{ cursor: "pointer" }}>
        <div
          className="fdot"
          style={{
            background: item.readyForRemix
              ? "var(--lime)"
              : "rgba(255,255,255,.2)",
          }}
        />
        <div className="fdot" style={{ background: "rgba(255,255,255,.12)" }} />
        <div className="ftit">@{item.handle ?? "unknown"}</div>
        <button
          className="btn btn-sm"
          style={{
            marginLeft: "auto",
            ...(confirmingDelete
              ? { color: "var(--fail)", borderColor: "var(--fail)" }
              : undefined),
          }}
          title={
            confirmingDelete
              ? "Click again to permanently delete this reel and every remix made from it"
              : "Delete this reel"
          }
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          {confirmingDelete ? (
            "Delete?"
          ) : (
            <Trash2 size={14} aria-hidden="true" />
          )}
        </button>
      </div>

      <div className="cl-thumb curated-preview">
        {item.sourceVideoUrl ? (
          <video
            src={item.sourceVideoUrl + "#t=0.1"}
            controls
            playsInline
            preload="metadata"
            title={item.hookLine ?? "Source reel"}
          />
        ) : (
          <a
            className="trend-source-placeholder"
            href={item.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            <Clapperboard aria-hidden="true" />
            <span>Source reel</span>
            <span className="btn">
              Open source
              <ArrowUpRight aria-hidden="true" />
            </span>
          </a>
        )}
      </div>
      <div className="cl-card-body">
        <div
          className="cl-title"
          onClick={onOpen}
          style={{ cursor: "pointer" }}
        >
          {item.hookLine || item.caption || "(no caption)"}
        </div>
        <div className="cl-card-top" style={{ marginTop: 8 }}>
          <a href={item.sourceUrl} target="_blank" rel="noreferrer">
            View source <ArrowUpRight size={12} aria-hidden="true" />
          </a>
        </div>
        <div className="cl-card-bottom">
          <span className={item.readyForRemix ? "cl-used used" : "cl-used"}>
            {item.readyForRemix
              ? "Ready"
              : `Needs artifacts (${uploadedCount}/${artifacts.length || 0})`}
          </span>
          {/* Deliberately separate from onOpen's admin artifact-management
           * modal — sourcing artifacts (admin/backend) and triggering a
           * remix (the brand-side action) are two different people's jobs
           * in the real product, even though nothing enforces that split
           * yet (no auth exists — see the page-level doc comment). Only
           * showing this once ready keeps that boundary visible in the UI
           * itself rather than bundling both into one popup. */}
          {item.readyForRemix && (
            <button className="btn btn-pri" onClick={onRemix}>
              <Shuffle size={14} aria-hidden="true" /> Remix
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Read-only scouting card for an auto-discovered (Apify-scraped) reel —
 * the old Content Library's own card, trimmed down. No remix/delete
 * actions: this half of the merged list is pure browsing, matching the
 * "merge with a filter, not a rewrite" scope — promoting one of these into
 * a curated reel is a deliberately separate decision, not built here. */
function AutoDiscoveredCard({
  item,
  playingId,
  setPlayingId,
}: {
  item: AutoDiscoveredItem;
  playingId: string | null;
  setPlayingId: (id: string | null) => void;
}) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const matched = (item.matchedSkeletons?.length ?? 0) > 0;

  return (
    <div className="frame cl-card">
      <div className="fbar">
        <div
          className="fdot"
          style={{
            background: matched ? "var(--lime)" : "rgba(255,255,255,.2)",
          }}
        />
        <div className="fdot" style={{ background: "rgba(255,255,255,.12)" }} />
        <div className="ftit">
          {item.platform.toUpperCase()} · @{item.handle ?? "unknown"}
        </div>
      </div>

      {playingId === item.id ? (
        <div className="cl-thumb cl-thumb-playing">
          <button
            type="button"
            className="cl-thumb-close"
            onClick={() => setPlayingId(null)}
            aria-label="Close"
          >
            ×
          </button>
          {item.platform === "instagram" ? (
            <InstagramEmbed key={item.id} permalink={item.sourceUrl} />
          ) : youTubeEmbedUrl(item.sourceUrl) ? (
            <iframe
              key={item.id}
              src={youTubeEmbedUrl(item.sourceUrl)!}
              width="100%"
              height="100%"
              style={{ border: 0 }}
              allow="autoplay; encrypted-media"
              allowFullScreen
            />
          ) : (
            <div className="rc-original-loading">
              Can&apos;t embed this one.
            </div>
          )}
        </div>
      ) : item.thumbnailUrl && !thumbFailed ? (
        <div className="cl-thumb-wrap" onClick={() => setPlayingId(item.id)}>
          <img
            className="cl-thumb"
            src={item.thumbnailUrl}
            alt=""
            loading="lazy"
            onError={() => setThumbFailed(true)}
          />
          <span className="cl-thumb-play">
            <Play size={18} aria-hidden="true" />
          </span>
        </div>
      ) : (
        <div
          className="cl-thumb-wrap cl-thumb-fallback"
          onClick={() => setPlayingId(item.id)}
        >
          <div className="cl-thumb" />
          <span className="cl-thumb-fallback-label">Preview expired</span>
          <span className="cl-thumb-play">
            <Play size={18} aria-hidden="true" />
          </span>
        </div>
      )}

      <div className="cl-card-body">
        {item.viewCount != null && (
          <div className="cl-views" style={{ marginBottom: 6 }}>
            {compactCount(item.viewCount)} plays
          </div>
        )}
        <div className="cl-title">
          {item.hookLine || item.title || "(untitled)"}
        </div>
        {matched && (
          <div className="cl-skeletons">
            {item.matchedSkeletons!.map((s) => (
              <span className="cl-skeleton" key={s}>
                {s.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        )}
        <div className="cl-card-bottom">
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 12 }}
          >
            View source <ArrowUpRight size={12} aria-hidden="true" />
          </a>
          <span className={item.remixCount > 0 ? "cl-used used" : "cl-used"}>
            {item.remixCount > 0 ? `Used ×${item.remixCount}` : "Never remixed"}
          </span>
        </div>
      </div>
    </div>
  );
}

function ImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [urlsText, setUrlsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    imported: number;
    skipped: number;
    errors: string[];
  } | null>(null);

  async function submit() {
    if (!file && !urlsText.trim()) return;
    setBusy(true);
    const form = new FormData();
    if (file) form.append("file", file);
    if (urlsText.trim()) form.append("urls", urlsText);
    const res = await fetch("/api/viral-trends/import", {
      method: "POST",
      body: form,
    });
    const data = await res.json();
    setBusy(false);
    setResult(data);
    if (res.ok) onImported();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="remix-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">Import reels</div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="modal-sub">
          CSV with columns: url (required), caption, handle.
        </div>

        <input
          type="file"
          accept=".csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />

        <div className="modal-sub" style={{ marginTop: 14 }}>
          Or paste links directly, one per line:
        </div>
        <textarea
          rows={5}
          placeholder={
            "https://www.instagram.com/reel/...\nhttps://www.instagram.com/reel/..."
          }
          value={urlsText}
          onChange={(e) => setUrlsText(e.target.value)}
          style={{ width: "100%", resize: "vertical" }}
        />

        {result && (
          <div className="modal-sub" style={{ marginTop: 10 }}>
            Imported {result.imported}, skipped {result.skipped}.
            {result.errors.length > 0 && (
              <ul>
                {result.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="modal-footer">
          <div />
          <button
            className="btn btn-pri"
            disabled={(!file && !urlsText.trim()) || busy}
            onClick={submit}
          >
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Admin/backend surface only — sourcing artifacts and marking a reel
 * ready. No remix action lives here; see RemixModal below for that
 * separate, brand-side surface. */
function DetailModal({
  item,
  onClose,
  onChanged,
}: {
  item: ViralTrendItem;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [newLabel, setNewLabel] = useState("");
  const [newFile, setNewFile] = useState<File | null>(null);
  const [adding, setAdding] = useState(false);
  const [captionDraft, setCaptionDraft] = useState(item.caption ?? "");
  const [savingCaption, setSavingCaption] = useState(false);
  const [readyError, setReadyError] = useState<string | null>(null);
  const [fetchingCaption, setFetchingCaption] = useState(false);
  const [fetchCaptionError, setFetchCaptionError] = useState<string | null>(
    null,
  );
  const [fetchCaptionNote, setFetchCaptionNote] = useState<string | null>(null);
  const hasSkeleton = (item.matchedSkeletons?.length ?? 0) > 0;

  /** Reels added via the "paste links" quick path have no caption at all —
   * confirmed live: one sat "ready", Remix was clicked, and 0 candidates
   * were found with nothing telling the admin why, because
   * remixSkeletonMatchedItems's candidate query requires a matched
   * skeleton, which needs a real caption to match against. This lets an
   * admin add one after the fact instead of that reel being silently
   * stuck forever. */
  async function saveCaption() {
    setSavingCaption(true);
    await fetch(`/api/viral-trends/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caption: captionDraft }),
    });
    setSavingCaption(false);
    onChanged();
  }

  /** Real Instagram metadata (the actual post caption, not OCR/vision-
   * reading the on-screen text) — confirmed live the same Apify call
   * fetch-original already makes was silently discarding this field. Real
   * cost (~$0.075/reel via Apify), so this is an explicit button, never
   * automatic — same reasoning as generate-artifact-remix's own real-spend
   * gating elsewhere in this app. Never overwrites a caption already typed
   * in by hand (enforced server-side too). */
  async function fetchRealCaption() {
    setFetchingCaption(true);
    setFetchCaptionError(null);
    setFetchCaptionNote(null);
    const res = await fetch(`/api/trend-items/${item.id}/fetch-original`, {
      method: "POST",
    });
    setFetchingCaption(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFetchCaptionError(data.error ?? "Fetch failed.");
      return;
    }
    const data = await res.json();
    if (data.item?.caption) {
      setCaptionDraft(data.item.caption);
    } else {
      // The fetch genuinely succeeded (real video downloaded, confirmed by
      // the caller checking sourceVideoUrl) — vision just didn't find any
      // on-screen text overlay to read, and this reel's own Instagram
      // caption (a separate, often unrelated field) was empty too.
      // Confirmed live this silent case read as "the button did nothing"
      // with zero feedback either way. MOCK_MODE=true always lands here
      // (vision calls are skipped, not faked) — a real reel with no text
      // overlay and no caption is the other case.
      setFetchCaptionNote(
        "Downloaded, but no on-screen text or caption came back — either MOCK_MODE=true (vision reading is skipped in mock mode), or this reel genuinely has no text overlay and no caption. Paste it manually if you can read it off the video, or pick a format below instead.",
      );
    }
    onChanged();
  }

  /** One action, not the hidden two-step flow this replaced (add a label ->
   * only THEN does an upload control appear in the list below, which real
   * usage showed wasn't discoverable at all). Picking a file alongside the
   * label here uploads it immediately as part of adding; leaving no file
   * chosen still works, and the row-level upload below remains for filling
   * in a slot added without a file on hand yet. */
  async function addArtifact() {
    // A picked file is enough on its own — confirmed live: requiring a
    // typed label even when a file is already chosen left the button
    // permanently disabled for anyone who just picks a file and expects
    // that to be sufficient. Falls back to the filename (minus extension)
    // so the artifact still gets a sensible label either way.
    const label =
      newLabel.trim() || newFile?.name.replace(/\.[^.]+$/, "") || "";
    if (!label) return;
    setAdding(true);
    const res = await fetch(`/api/viral-trends/${item.id}/artifacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    const data = await res.json();
    const created = data.item?.artifacts?.[data.item.artifacts.length - 1];

    if (created && newFile) {
      const form = new FormData();
      form.append("file", newFile);
      await fetch(
        `/api/viral-trends/${item.id}/artifacts/${created.id}/upload`,
        { method: "POST", body: form },
      );
    }

    setNewLabel("");
    setNewFile(null);
    setAdding(false);
    onChanged();
  }

  async function removeArtifact(artifactId: string) {
    await fetch(`/api/viral-trends/${item.id}/artifacts/${artifactId}`, {
      method: "DELETE",
    });
    onChanged();
  }

  async function uploadArtifact(artifactId: string, file: File) {
    const form = new FormData();
    form.append("file", file);
    await fetch(`/api/viral-trends/${item.id}/artifacts/${artifactId}/upload`, {
      method: "POST",
      body: form,
    });
    onChanged();
  }

  async function toggleReady() {
    const res = await fetch(`/api/viral-trends/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ readyForRemix: !item.readyForRemix }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setReadyError(data.error ?? "Couldn't update ready status.");
      return;
    }
    setReadyError(null);
    onChanged();
  }

  const artifacts = item.artifacts ?? [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="remix-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">@{item.handle ?? "unknown"}</div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="modal-sub">
          <a href={item.sourceUrl} target="_blank" rel="noreferrer">
            {item.sourceUrl}
          </a>
        </div>
        <div className="modal-sub" style={{ fontWeight: 700, marginTop: 14 }}>
          On-screen hook text
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            placeholder="Paste the text baked into the reel's video here"
            value={captionDraft}
            onChange={(e) => setCaptionDraft(e.target.value)}
            style={{ flex: 1 }}
          />
          <button
            className="btn"
            disabled={savingCaption || captionDraft === (item.caption ?? "")}
            onClick={saveCaption}
          >
            {savingCaption ? "Saving…" : "Save"}
          </button>
        </div>
        <div style={{ marginTop: 6 }}>
          <button
            className="btn btn-sm"
            disabled={fetchingCaption || !!item.caption}
            onClick={fetchRealCaption}
          >
            {fetchingCaption
              ? "Fetching…"
              : "Read on-screen text from the reel (~$0.075)"}
          </button>
          {fetchCaptionError && (
            <div
              className="modal-sub"
              style={{ color: "var(--fail)", marginTop: 4 }}
            >
              ⚠️ {fetchCaptionError}
            </div>
          )}
          {fetchCaptionNote && (
            <div className="modal-sub" style={{ marginTop: 4 }}>
              ℹ️ {fetchCaptionNote}
            </div>
          )}
        </div>
        {!hasSkeleton && !item.caption && (
          <div
            className="modal-sub"
            style={{ color: "var(--fail)", marginTop: 6 }}
          >
            ⚠️ No caption yet. Add the real one above (Remix will ground the
            copy in it automatically, format picker not required), or leave it
            blank and pick a format directly when you hit Remix.
          </div>
        )}

        <div className="modal-sub" style={{ fontWeight: 700, marginTop: 14 }}>
          Artifacts
        </div>
        {artifacts.length === 0 && (
          <div className="modal-sub">No artifacts added yet.</div>
        )}
        {artifacts.map((a) => (
          <div
            key={a.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 6,
            }}
          >
            <span style={{ flex: 1 }}>
              {a.status === "uploaded" ? "✅" : "⬜"} {a.label}
              {a.fileUrl && (
                <>
                  {" "}
                  —{" "}
                  <a href={a.fileUrl} target="_blank" rel="noreferrer">
                    view
                  </a>
                </>
              )}
            </span>
            {a.status === "needed" && (
              <input
                type="file"
                style={{ maxWidth: 160 }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadArtifact(a.id, f);
                }}
              />
            )}
            <button className="btn" onClick={() => removeArtifact(a.id)}>
              Remove
            </button>
          </div>
        ))}

        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 10,
            alignItems: "center",
          }}
        >
          <input
            type="text"
            placeholder="Artifact label (e.g. reaction subject photo)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            style={{ flex: 1 }}
          />
          <input
            type="file"
            style={{ maxWidth: 160 }}
            onChange={(e) => setNewFile(e.target.files?.[0] ?? null)}
          />
          <button
            className="btn"
            disabled={(!newLabel.trim() && !newFile) || adding}
            onClick={addArtifact}
          >
            {adding ? "Adding…" : "+ Add artifact"}
          </button>
        </div>
        <div className="modal-sub" style={{ marginTop: 4 }}>
          Pick a file here to upload it right away, or just add the label and
          upload it later below.
        </div>

        {readyError && (
          <div
            className="modal-sub"
            style={{ color: "var(--fail)", marginTop: 12 }}
          >
            ⚠️ {readyError}
          </div>
        )}
        <label className="remix-picker-option" style={{ marginTop: 16 }}>
          <input
            type="checkbox"
            checked={item.readyForRemix}
            onChange={toggleReady}
          />
          <span>Mark ready for remix</span>
        </label>
      </div>
    </div>
  );
}

/** The brand-side action, separate from DetailModal above — only ever
 * opened from a ready card's own "Remix" button, never nested inside the
 * admin artifact-management surface. */
function RemixModal({
  item,
  products,
  onClose,
  onRemixed,
  onChanged,
}: {
  item: ViralTrendItem;
  products: Product[];
  onClose: () => void;
  onRemixed: (message: string) => void;
  onChanged: () => void;
}) {
  const brand = useBrand();
  const [remixMode, setRemixMode] = useState<"brand" | "product">("brand");
  const [remixProductId, setRemixProductId] = useState("");
  const [skeletonId, setSkeletonId] = useState("");
  const [remixing, setRemixing] = useState(false);
  const [remixError, setRemixError] = useState<string | null>(null);
  const [captionDraft, setCaptionDraft] = useState(item.caption ?? "");
  const [savingCaption, setSavingCaption] = useState(false);
  const [fetchingCaption, setFetchingCaption] = useState(false);
  const [fetchCaptionError, setFetchCaptionError] = useState<string | null>(
    null,
  );
  const [fetchCaptionNote, setFetchCaptionNote] = useState<string | null>(null);
  // A real caption is sufficient on its own now — the server (see
  // /api/remix/skeleton-matched's own comment) auto-defaults the skeleton
  // once a caption exists, since generateParodyHook overrides the only
  // beat that actually varies by skeleton anyway. Only block on a manual
  // pick when there's genuinely neither a caption nor a matched skeleton.
  const needsSkeleton =
    (item.matchedSkeletons?.length ?? 0) === 0 && !item.caption;

  // Same two real-caption paths as DetailModal — surfaced here too, since
  // this dialog is where an admin actually hits the "no caption" wall and
  // confirmed live went looking for a text box right here, not in a
  // separate modal they'd have to close this one to reach.
  async function saveCaption() {
    setSavingCaption(true);
    await fetch(`/api/viral-trends/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caption: captionDraft }),
    });
    setSavingCaption(false);
    onChanged();
  }

  async function fetchRealCaption() {
    setFetchingCaption(true);
    setFetchCaptionError(null);
    setFetchCaptionNote(null);
    const res = await fetch(`/api/trend-items/${item.id}/fetch-original`, {
      method: "POST",
    });
    setFetchingCaption(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFetchCaptionError(data.error ?? "Fetch failed.");
      return;
    }
    const data = await res.json();
    if (data.item?.caption) {
      setCaptionDraft(data.item.caption);
    } else {
      // See DetailModal's identical fetchRealCaption comment.
      setFetchCaptionNote(
        "Downloaded, but no on-screen text or caption came back — either MOCK_MODE=true (vision reading is skipped in mock mode), or this reel genuinely has no text overlay and no caption. Paste it manually if you can read it off the video, or pick a format below instead.",
      );
    }
    onChanged();
  }

  async function triggerRemix() {
    setRemixing(true);
    setRemixError(null);
    const res = await fetch("/api/remix/skeleton-matched", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trendItemIds: [item.id],
        ...(remixMode === "product"
          ? { mode: "product", productId: remixProductId }
          : { mode: "brand" }),
        ...(needsSkeleton ? { skeletonId } : {}),
      }),
    });
    setRemixing(false);
    if (res.ok) {
      // Closes the picker immediately rather than leaving it open with a
      // success line tacked on below the button — confirmed live that was
      // confusing UX (looked like nothing happened until you noticed the
      // small text and closed it yourself). The parent shows a transient
      // balloon in its place.
      onRemixed("Remix triggered — check the Remixes page shortly.");
    } else {
      const body = await res.json().catch(() => ({}));
      setRemixError(body.error ?? "Remix failed to trigger.");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="remix-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">Remix @{item.handle ?? "unknown"}</div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="modal-sub">
          Fills this reel with copy for one specific product, or for the brand
          in general.
        </div>

        <label className="remix-picker-option">
          <input
            type="radio"
            checked={remixMode === "brand"}
            onChange={() => setRemixMode("brand")}
          />
          <span>{brand.name} in general</span>
        </label>
        <label className="remix-picker-option">
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
            disabled={products.length === 0}
          >
            <option value="">Select a product…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        )}

        {/*
         * Caption box always visible/editable here, regardless of whether
         * a format pick is still needed — confirmed live that gating this
         * on needsSkeleton made the box (and the ability to see or fix
         * what caption is on record) disappear entirely the moment a
         * caption existed, with no way back to it short of a different
         * modal. Whether a real caption exists and whether a format
         * picker is ALSO required are two separate questions; only the
         * dropdown below should depend on the second one.
         */}
        <div className="modal-sub" style={{ marginTop: 12 }}>
          {item.caption
            ? "This reel's on-screen hook text (edit and Save to update):"
            : "This reel has no hook text on record yet — either option below fills it in:"}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <input
            type="text"
            placeholder="Paste the text baked into the reel's video here"
            value={captionDraft}
            onChange={(e) => setCaptionDraft(e.target.value)}
            style={{ flex: 1 }}
          />
          <button
            className="btn"
            disabled={savingCaption || captionDraft === (item.caption ?? "")}
            onClick={saveCaption}
          >
            {savingCaption ? "Saving…" : "Save"}
          </button>
        </div>
        <div style={{ marginTop: 6 }}>
          <button
            className="btn btn-sm"
            disabled={fetchingCaption}
            onClick={fetchRealCaption}
          >
            {fetchingCaption
              ? "Fetching…"
              : "Read on-screen text from the reel (~$0.075)"}
          </button>
          {fetchCaptionError && (
            <div
              className="modal-sub"
              style={{ color: "var(--fail)", marginTop: 4 }}
            >
              ⚠️ {fetchCaptionError}
            </div>
          )}
          {fetchCaptionNote && (
            <div className="modal-sub" style={{ marginTop: 4 }}>
              ℹ️ {fetchCaptionNote}
            </div>
          )}
        </div>

        {needsSkeleton && (
          <>
            <div className="modal-sub" style={{ marginTop: 12 }}>
              Or, with no caption, just pick the format this reel actually uses:
            </div>
            <select
              className="remix-picker-select"
              value={skeletonId}
              onChange={(e) => setSkeletonId(e.target.value)}
            >
              <option value="">Select a format…</option>
              {Object.values(SKELETONS).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </>
        )}

        <div className="modal-footer">
          <div
            style={remixError ? { color: "var(--red, #e5484d)" } : undefined}
          >
            {remixError}
          </div>
          <button
            className="btn btn-pri"
            disabled={
              remixing ||
              (remixMode === "product" && !remixProductId) ||
              (needsSkeleton && !skeletonId)
            }
            onClick={triggerRemix}
          >
            {remixing ? "Remixing…" : "Remix"}
          </button>
        </div>
      </div>
    </div>
  );
}
