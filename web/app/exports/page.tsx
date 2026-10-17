"use client";
import { Download, Share2, Play } from "lucide-react";
import { PageHeader } from "../PageHeader";

import { useEffect, useState } from "react";

interface ExportPost {
  post: {
    id: string;
    status: string;
    renderedFileUrl: string | null;
    renderedAt: string | null;
  };
  script: { hook: string | null };
  trendItem: { platform: string; handle: string | null };
}

/** Cosmetic only — decides which label to show ("Share to Instagram" vs
 * "Download"). The actual click handler below always does real feature
 * detection at share-time and falls back safely regardless of what this
 * guesses, so a wrong guess here never breaks anything, it just shows a
 * slightly less accurate label. */
function looksLikeMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/**
 * navigator.share with a real File only works when the OS registers a
 * share target for it — reliably true on phones with Instagram installed
 * (iOS Safari 15+, Android Chrome), essentially never true on Windows/Mac
 * desktop browsers (no desktop Instagram app hooks into either OS's share
 * contract) — confirmed by design, not something this dev environment can
 * verify directly since it has no OS-level share targets registered.
 * canShare({files}) is checked with the REAL file right before sharing —
 * the only way to know for certain — and a plain download always happens
 * on any failure, so this is correct on every device regardless of the
 * cosmetic label above.
 */
async function shareOrDownload(videoUrl: string, title: string) {
  try {
    const res = await fetch(videoUrl);
    if (!res.ok) throw new Error("Download failed");
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
    // AbortError just means the person closed the native share sheet
    // without picking anything — not a real failure, nothing to fall back
    // from since they saw the option and chose not to use it.
    if (e instanceof Error && e.name === "AbortError") return;
    // Any other real failure (fetch failed, etc.) — plain link download as
    // the last-resort fallback, no JS blob handling needed.
    window.open(videoUrl, "_blank");
  }
}

/** Separate component so each card owns its own "is the real <video>
 * mounted yet" state. Confirmed live this page had the exact same
 * connection-pool-exhaustion bug fixed on Remixes/Generate Content weeks
 * ago but never ported here: every kept post's <video src> was mounted
 * unconditionally, all firing at once (18 real network requests here),
 * and the browser's per-origin connection limit aborted most of them
 * (net::ERR_ABORTED on every one, confirmed in the network log). Shows
 * the same real poster frame as a static <img> by default — cheap, no
 * connection contention — and only mounts the real <video> on click. */
function ExportCard({
  post,
  script,
  trendItem,
  mobile,
  sharing,
  onShare,
}: {
  post: ExportPost["post"];
  script: ExportPost["script"];
  trendItem: ExportPost["trendItem"];
  mobile: boolean;
  sharing: boolean;
  onShare: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);

  return (
    <article className="export-card">
      <div className="export-media">
        {post.renderedFileUrl ? (
          playing ? (
            <video src={post.renderedFileUrl} controls autoPlay playsInline />
          ) : (
            <button
              className="export-play"
              onClick={() => setPlaying(true)}
              aria-label={"Play " + (script.hook ?? "video")}
            >
              {!posterFailed && (
                <img
                  src={"/storage/rendered-posts/" + post.id + "-poster.jpg"}
                  alt=""
                  loading="lazy"
                  onError={() => setPosterFailed(true)}
                />
              )}
              <span>
                <Play size={20} aria-hidden="true" />
              </span>
            </button>
          )
        ) : (
          <div className="empty-state">Rendering...</div>
        )}
      </div>
      <div className="export-card-body">
        <div className="export-meta">
          <span>{trendItem.handle ?? trendItem.platform}</span>
          <span className="library-status">
            {post.renderedFileUrl ? "Ready" : "Rendering"}
          </span>
        </div>
        <h2>{script.hook ?? "Untitled creative"}</h2>
        {post.renderedFileUrl && (
          <button className="btn" disabled={sharing} onClick={onShare}>
            {mobile ? (
              <Share2 aria-hidden="true" />
            ) : (
              <Download aria-hidden="true" />
            )}
            {sharing
              ? "Preparing..."
              : mobile
                ? "Share video"
                : "Download video"}
          </button>
        )}
      </div>
    </article>
  );
}
export default function ExportsPage() {
  const [posts, setPosts] = useState<ExportPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [mobile, setMobile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/exports");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load exports");
      setPosts(data.posts ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load exports");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const initial = setTimeout(() => {
      void load();
      setMobile(looksLikeMobile());
    }, 0);
    // Renders happen async server-side — poll a few times so a just-kept
    // post's video shows up without a manual refresh.
    const interval = setInterval(load, 4000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, []);

  return (
    <div>
      <PageHeader
        title="Exports"
        subtitle={loading ? "Loading..." : posts.length + " approved creatives"}
      />
      {error && (
        <div className="empty-state" role="alert">
          {error}
          <button className="btn" onClick={load}>
            Retry
          </button>
        </div>
      )}
      {!loading && !error && posts.length === 0 && (
        <div className="empty-state">No approved creatives yet.</div>
      )}

      <div className="cl-grid">
        {posts.map(({ post, script, trendItem }) => (
          <ExportCard
            key={post.id}
            post={post}
            script={script}
            trendItem={trendItem}
            mobile={mobile}
            sharing={sharingId === post.id}
            onShare={async () => {
              setSharingId(post.id);
              await shareOrDownload(
                post.renderedFileUrl!,
                script.hook ?? "GloVibe remix",
              );
              setSharingId(null);
            }}
          />
        ))}
      </div>
    </div>
  );
}
