"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  Check,
  Clapperboard,
  Download,
  Flame,
  ImageIcon,
  Layers,
  LoaderCircle,
  MessageCircle,
  Megaphone,
  Package,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Upload,
  X,
} from "lucide-react";
import type {
  FeedContext,
  FeedData,
  ReelKind,
  ReelSource,
  RemixIdea,
} from "@/lib/brand-feed/types";
import RemixPlayer from "./RemixPlayer";
import "./brand-feed.css";

type View = "feed" | "saved" | "library";
const LABELS = {
  trend: "Trend remix",
  viral: "Viral remix",
  product: "Product remix",
};
const ICONS = { trend: TrendingUp, viral: Flame, product: Package };
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init }),
    raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error("The response was incomplete. Please try again.");
  }
  if (!response.ok)
    throw new Error(data.error || "This action could not be completed.");
  return data as T;
}
const command = (body: Record<string, unknown>) =>
  request("/api/brand-feed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
function Media({
  src,
  type,
  alt,
  onUnavailable,
}: {
  src?: string | null;
  type?: string;
  alt: string;
  onUnavailable?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed)
    return (
      <div className="bf-media-fallback">
        <ImageIcon />
        <span>{alt}</span>
      </div>
    );
  return type === "video" ? (
    <video
      className="bf-media"
      src={src}
      muted
      playsInline
      preload="metadata"
      onError={() => {
        setFailed(true);
        onUnavailable?.();
      }}
    />
  ) : (
    <img
      className="bf-media"
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => {
        setFailed(true);
        onUnavailable?.();
      }}
    />
  );
}
export default function BrandFeed({
  initialView = "feed",
}: {
  initialView?: View;
}) {
  const [data, setData] = useState<FeedData | null>(null),
    [loading, setLoading] = useState(true);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState("");
  const [filter, setFilter] = useState<"all" | ReelKind>("all"),
    [focus, setFocus] = useState("all");
  const [selectedId, setSelectedId] = useState(""),
    [editing, setEditing] = useState(false);
  const [showSource, setShowSource] = useState(false),
    [captions, setCaptions] = useState<string[]>([]);
  const [dialog, setDialog] = useState<
    "direction" | "upload" | "assemble" | null
  >(null);
  const [context, setContext] = useState<FeedContext | null>(null),
    [reviewed, setReviewed] = useState(false);
  const [sourceLimit, setSourceLimit] = useState(18);
  const [unavailableMedia, setUnavailableMedia] = useState<string[]>([]);
  const librarySources = (data?.sources || [])
    .map((source) => ({
      ...source,
      media: source.media.filter(
        (asset) => !unavailableMedia.includes(asset.src),
      ),
    }))
    .filter(
      (source) =>
        source.media.length > 0 && (filter === "all" || source.kind === filter),
    );
  const dialogRef = useRef<HTMLDialogElement>(null),
    generation = useRef(0);
  const selected = data?.feed.ideas.find((i) => i.id === selectedId);
  const hasJobs = !!data?.feed.ideas.some(
    (i) => i.job && ["queued", "rendering"].includes(i.job.state),
  );
  const reload = useCallback(async () => {
    const current = ++generation.current;
    try {
      const value = await request<FeedData>("/api/brand-feed");
      if (current === generation.current) setData(value);
    } catch (e) {
      if (current === generation.current)
        setError(
          e instanceof Error ? e.message : "Your feed could not be loaded.",
        );
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void reload(), 0);
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [reload]);
  useEffect(() => {
    const update = () => void reload();
    window.addEventListener("runtime-mode-changed", update);
    return () => window.removeEventListener("runtime-mode-changed", update);
  }, [reload]);
  useEffect(() => {
    if (!hasJobs) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, 6000);
    return () => clearInterval(timer);
  }, [hasJobs, reload]);
  useEffect(() => {
    if (dialog) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [dialog]);
  async function perform(label: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "This action failed.");
    } finally {
      setBusy("");
    }
  }
  async function decision(idea: RemixIdea, value: "new" | "kept" | "skipped") {
    await command({ action: "decision", ideaId: idea.id, decision: value });
    await reload();
    if (value === "skipped") setSelectedId("");
    setNotice(
      value === "kept"
        ? "Idea kept. No paid generation authorized."
        : value === "skipped"
          ? "Idea skipped."
          : "Idea removed from your shortlist.",
    );
  }
  function openIdea(idea: RemixIdea, edit = false) {
    setSelectedId(idea.id);
    setEditing(edit);
    setShowSource(false);
    setCaptions(idea.scenes.map((s) => s.caption));
    setNotice("");
    setError("");
    setReviewed(false);
  }
  function direction() {
    if (data) setContext({ ...data.feed.context });
    setDialog("direction");
  }
  const ideas =
    data?.feed.ideas.filter(
      (i) =>
        (initialView === "saved"
          ? i.decision === "kept"
          : i.decision !== "skipped") &&
        (filter === "all" || i.kind === filter) &&
        (focus === "all" ||
          (focus === "message" ? i.kind !== "product" : i.productId === focus)),
    ) || [];
  const kept =
    data?.feed.ideas.filter((i) => i.decision === "kept").length || 0;
  const title =
    initialView === "saved"
      ? "Your kept ideas."
      : "Remixed for " + (data?.brand.name || "your brand") + ".";
  function card(idea: RemixIdea) {
    const Icon = ICONS[idea.kind];
    return (
      <article className="bf-reel" key={idea.id}>
        <div className={"bf-visual " + idea.kind}>
          <Media
            key={idea.scenes[0]?.src}
            src={idea.scenes[0]?.src}
            type={idea.scenes[0]?.type}
            alt={
              idea.kind === "product"
                ? idea.productName || "Product"
                : "Sourced reel visual"
            }
          />
          <span className="bf-visual-label">
            {data?.brand.name} /{" "}
            {idea.kind === "product" ? "Product spotlight" : "Relatable moment"}
          </span>
          <div
            className={
              "bf-card-caption " + (idea.kind === "product" ? "product" : "")
            }
          >
            {idea.scenes[0]?.caption}
          </div>
          <button
            className="bf-play"
            aria-label={"Preview " + idea.title}
            title="Preview reel"
            onClick={() => openIdea(idea)}
          >
            <Play />
          </button>
          <span className="bf-duration">
            {idea.job?.state === "complete"
              ? "Video ready"
              : idea.kind === "product"
                ? "Image storyboard"
                : "Draft preview"}
          </span>
        </div>
        <div className="bf-card-body">
          <div className="bf-source-label">
            <Icon />
            {LABELS[idea.kind]}
          </div>
          <h2>{idea.title}</h2>
          <p className="bf-card-description">
            {idea.kind === "product"
              ? "Your actual packaging, in a product-led direction."
              : "A familiar format. Your message does the work."}
          </p>
          <div className="bf-brand-use">
            {idea.kind === "product" ? <Package /> : <MessageCircle />}
            {idea.kind === "product"
              ? "Product-led"
              : "Message-led / No product shot"}
          </div>
          {idea.job && (
            <p
              className={
                "bf-job-status " + (idea.job.state === "failed" ? "failed" : "")
              }
            >
              {idea.job.state === "complete" ? (
                "Ready for review"
              ) : idea.job.state === "failed" ? (
                "Assembly stopped"
              ) : (
                <>
                  <LoaderCircle className="bf-spin" />
                  Assembling your video
                </>
              )}
            </p>
          )}
          <div className="bf-card-actions">
            <button
              className="bf-keep"
              disabled={!!busy}
              onClick={() =>
                void perform(idea.id, () =>
                  decision(idea, idea.decision === "kept" ? "new" : "kept"),
                )
              }
            >
              {idea.decision === "kept" ? <Check /> : <Bookmark />}
              {idea.decision === "kept" ? "Kept" : "Keep"}
            </button>
            <button disabled={!!busy} onClick={() => openIdea(idea, true)}>
              <SlidersHorizontal />
              Change
            </button>
            <button
              className="bf-icon"
              disabled={
                !!busy ||
                (!!idea.job && ["queued", "rendering"].includes(idea.job.state))
              }
              aria-label={"Skip " + idea.title}
              title="Skip idea"
              onClick={() =>
                void perform(idea.id, () => decision(idea, "skipped"))
              }
            >
              <X />
            </button>
          </div>
        </div>
      </article>
    );
  }
  function sourceCard(source: ReelSource) {
    const Icon = ICONS[source.kind],
      media = source.media[0];
    return (
      <article className="bf-reel" key={source.id}>
        <div className="bf-reference-visual">
          <Media
            key={media?.src || source.thumbnailUrl}
            src={media?.src || source.thumbnailUrl}
            type={media?.type}
            alt={source.title}
            onUnavailable={() => {
              if (media)
                setUnavailableMedia((previous) =>
                  previous.includes(media.src)
                    ? previous
                    : [...previous, media.src],
                );
            }}
          />
        </div>
        <div className="bf-card-body">
          <div className="bf-source-label">
            <Icon />
            {source.kind === "product"
              ? "Product reference"
              : LABELS[source.kind]}{" "}
            / {source.ready ? "Ready" : "Needs local media"}
          </div>
          <h2>{source.title}</h2>
          {source.uploadedSample ? (
            <p className="bf-card-description">Uploaded reference</p>
          ) : (
            <label className="bf-field">
              Reference type
              <select
                value={source.kind}
                disabled={!!busy}
                onChange={(e) => {
                  const kind = e.target.value;
                  void perform("source", async () => {
                    await command({
                      action: "source-kind",
                      sourceId: source.id,
                      kind,
                    });
                    await reload();
                    setNotice(
                      "Reference type saved. New batches will use this classification.",
                    );
                  });
                }}
              >
                <option value="trend">Trend reel</option>
                <option value="viral">Viral reel</option>
                <option value="product">Product reel</option>
              </select>
            </label>
          )}
          <div className="bf-card-actions">
            {source.sourceUrl && (
              <a
                href={source.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="bf-button"
              >
                Original reel
                <ArrowUpRight />
              </a>
            )}
            {!source.uploadedSample && (
              <Link href="/viral-trends" className="bf-button">
                Manage
                <ArrowRight />
              </Link>
            )}
          </div>
        </div>
      </article>
    );
  }
  return (
    <div className="bf-workspace">
      <header className="bf-topbar">
        <div className="bf-breadcrumb">
          {data?.brand.name || "Your brand"}
          <span>/</span>
          {selected
            ? "Reel preview"
            : initialView === "library"
              ? "Reel library"
              : initialView === "saved"
                ? "Kept reels"
                : "For your brand"}
        </div>
        <div className="bf-top-actions">
          <span className="bf-mode-label">
            {data?.mockMode ? "Test mode" : data ? "Live mode" : ""}
          </span>
          <div className="bf-mode">
            <span>
              <Sparkles />
              Agent
            </span>
            <Link href="/workspace">
              <SlidersHorizontal />
              Workspace
            </Link>
          </div>
        </div>
      </header>
      <div className="bf-content">
        {error && (
          <div className="bf-alert" role="alert">
            <span>{error}</span>
            <button
              disabled={!!busy}
              onClick={() => {
                setError("");
                void reload();
              }}
            >
              <RefreshCw />
              Refresh
            </button>
            <button
              className="bf-icon"
              title="Dismiss error"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X />
            </button>
          </div>
        )}
        {notice && (
          <div className="bf-notice" role="status">
            <Check />
            <span>{notice}</span>
            <button
              className="bf-icon"
              title="Dismiss message"
              aria-label="Dismiss message"
              onClick={() => setNotice("")}
            >
              <X />
            </button>
          </div>
        )}
        {loading ? (
          <div className="bf-loading">
            <LoaderCircle className="bf-spin" />
            <p>Preparing your brand workspace...</p>
          </div>
        ) : !data ? (
          <div className="bf-empty">
            <h1>Your feed is unavailable.</h1>
            <button onClick={() => void reload()}>
              <RefreshCw />
              Try again
            </button>
          </div>
        ) : selected ? (
          <>
            <button
              className="bf-text-button"
              onClick={() => {
                setSelectedId("");
                setEditing(false);
              }}
            >
              <ArrowLeft />
              Back to {initialView === "saved" ? "kept reels" : "your ideas"}
            </button>
            <div className="bf-detail-heading">
              <div>
                <div className="bf-eyebrow">{LABELS[selected.kind]}</div>
                <h1>{selected.title}</h1>
                <p>
                  {selected.kind === "product"
                    ? selected.productName
                    : "Message-led / No product shot"}
                </p>
              </div>
              {selected.source && (
                <button
                  className="bf-text-button"
                  aria-expanded={showSource}
                  onClick={() => setShowSource(!showSource)}
                >
                  <Layers />
                  Source format
                </button>
              )}
            </div>
            <div className="bf-detail-layout">
              <div className="bf-preview-column">
                {selected.job?.state === "complete" && selected.job.url ? (
                  <>
                    <video
                      key={selected.job.url}
                      className="bf-finished-video"
                      src={selected.job.url}
                      controls
                      playsInline
                    />
                    <div className="bf-preview-meta">
                      Finished video / Ready for review
                    </div>
                  </>
                ) : (
                  <>
                    <RemixPlayer
                      key={selected.id + ":" + selected.revision}
                      ideaId={selected.id}
                      scenes={selected.scenes}
                      brandName={data.brand.name}
                    />
                    <div className="bf-preview-meta">
                      9:16 / Silent{" "}
                      {selected.kind === "product"
                        ? "image storyboard"
                        : "rough cut"}
                    </div>
                  </>
                )}
              </div>
              <div className="bf-detail-info">
                <section>
                  <h2>Why this fits {data.brand.name}</h2>
                  <p>{selected.rationale}</p>
                </section>
                <section>
                  <h2>The brand remix</h2>
                  <p>{selected.adaptation}</p>
                  <div className="bf-beats">
                    {selected.scenes.map((s, i) => (
                      <div key={i}>
                        <small>
                          {selected.scenes.length === 1
                            ? "On-screen message"
                            : ["Opening", "Message", "Close"][i] ||
                              "Scene " + (i + 1)}{" "}
                          / {s.seconds}s
                        </small>
                        <p>{s.caption}</p>
                      </div>
                    ))}
                  </div>
                </section>
                {showSource && selected.source && (
                  <section className="bf-source-inspector">
                    <h2>{selected.source.title}</h2>
                    {selected.source.media[0] &&
                      (selected.source.media[0].type === "video" ? (
                        <video
                          controls
                          playsInline
                          src={selected.source.media[0].src}
                        />
                      ) : (
                        <img
                          src={selected.source.media[0].src}
                          alt="Original reference visual"
                        />
                      ))}
                    <p>{selected.source.caption}</p>
                    {selected.source.sourceUrl && (
                      <a
                        href={selected.source.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open original reel
                        <ArrowUpRight />
                      </a>
                    )}
                  </section>
                )}
                {editing && (
                  <section>
                    <h2>Adjust the message</h2>
                    {selected.job ? (
                      <p>
                        This version is already in production. Find more ideas
                        for a new version; its approved copy stays unchanged.
                      </p>
                    ) : (
                      <form
                        className="bf-edit-form"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void perform("edit", async () => {
                            await command({
                              action: "edit",
                              ideaId: selected.id,
                              revision: selected.revision,
                              captions,
                            });
                            await reload();
                            setEditing(false);
                            setNotice("Your preview has been updated.");
                          });
                        }}
                      >
                        {selected.scenes.map((_, i) => (
                          <label className="bf-field" key={i}>
                            {selected.scenes.length === 1
                              ? "On-screen message"
                              : ["Opening", "Message", "Close"][i]}
                            <textarea
                              value={captions[i] || ""}
                              required
                              maxLength={200}
                              rows={2}
                              onChange={(e) =>
                                setCaptions((old) =>
                                  old.map((v, n) =>
                                    n === i ? e.target.value : v,
                                  ),
                                )
                              }
                            />
                          </label>
                        ))}
                        <button disabled={!!busy} type="submit">
                          <Check />
                          Save changes
                        </button>
                      </form>
                    )}
                  </section>
                )}
                {selected.job?.state === "failed" && (
                  <div className="bf-alert" role="alert">
                    {selected.job.error || "Local assembly failed."}
                  </div>
                )}
                <div className="bf-detail-actions">
                  <button
                    className="bf-primary"
                    disabled={!!busy}
                    onClick={() =>
                      void perform(selected.id, () =>
                        decision(
                          selected,
                          selected.decision === "kept" ? "new" : "kept",
                        ),
                      )
                    }
                  >
                    {selected.decision === "kept" ? <Check /> : <Bookmark />}
                    {selected.decision === "kept" ? "Kept" : "Keep this idea"}
                  </button>
                  <button
                    disabled={!!busy}
                    onClick={() => {
                      setEditing(!editing);
                      setCaptions(selected.scenes.map((s) => s.caption));
                    }}
                  >
                    <SlidersHorizontal />
                    Change
                  </button>
                  <button
                    disabled={
                      !!busy ||
                      (!!selected.job &&
                        ["queued", "rendering"].includes(selected.job.state))
                    }
                    onClick={() =>
                      void perform(selected.id, () =>
                        decision(selected, "skipped"),
                      )
                    }
                  >
                    <X />
                    Skip
                  </button>
                </div>
                <section className="bf-production">
                  <h2>
                    {selected.job?.state === "complete"
                      ? "Your video is ready"
                      : "Create the video"}
                  </h2>
                  {selected.job?.state === "complete" && selected.job.url ? (
                    <div className="bf-detail-actions">
                      <a
                        className="bf-button bf-primary"
                        href={selected.job.url}
                        download
                      >
                        <Download />
                        Download video
                      </a>
                      <Link
                        href={"/drive-engagement?postId=" + selected.job.postId}
                        className="bf-button"
                      >
                        <Megaphone />
                        Drive engagement
                      </Link>
                      <Link href="/creatives" className="bf-button">
                        <Clapperboard />
                        Review creatives
                      </Link>
                    </div>
                  ) : selected.job &&
                    ["queued", "rendering"].includes(selected.job.state) ? (
                    <p role="status">
                      <LoaderCircle className="bf-spin" />
                      Assembling approved assets. You can continue browsing.
                    </p>
                  ) : !selected.job ? (
                    <>
                      <p>
                        Existing media and your approved message. No new AI
                        footage or provider calls.
                      </p>
                      <button
                        disabled={!!busy || selected.decision !== "kept"}
                        onClick={() => {
                          setReviewed(false);
                          setDialog("assemble");
                        }}
                      >
                        <Clapperboard />
                        Review &amp; assemble
                      </button>
                      {selected.decision !== "kept" && (
                        <small>Keep this idea first.</small>
                      )}
                    </>
                  ) : (
                    <p>
                      Your idea is preserved. Prepare a new batch to try a
                      different version.
                    </p>
                  )}
                  <small>
                    0 Runway credits / No paid generation authorized
                  </small>
                </section>
              </div>
            </div>
          </>
        ) : initialView === "library" ? (
          <>
            <div className="bf-page-heading">
              <div>
                <div className="bf-eyebrow">CREATIVE REFERENCES</div>
                <h1>The formats behind your ideas.</h1>
                <p>
                  Trend, viral and product references from your saved library.
                </p>
              </div>
              <button
                className="bf-primary"
                onClick={() => setDialog("upload")}
              >
                <Upload />
                Add reference
              </button>
            </div>
            <div className="bf-toolbar">
              <div className="bf-tabs" role="group" aria-label="Reference type">
                {(["all", "trend", "viral", "product"] as const).map((kind) => (
                  <button
                    key={kind}
                    className={filter === kind ? "active" : ""}
                    aria-pressed={filter === kind}
                    onClick={() => {
                      setFilter(kind);
                      setSourceLimit(18);
                    }}
                  >
                    {kind === "all"
                      ? "All references"
                      : kind === "product"
                        ? "Product reels"
                        : kind === "trend"
                          ? "Trend reels"
                          : "Viral reels"}
                  </button>
                ))}
              </div>
              <Link href="/viral-trends" className="bf-text-button">
                Manage reel sources
                <ArrowUpRight />
              </Link>
            </div>
            <div className="bf-grid bf-library-grid">
              {librarySources.slice(0, sourceLimit).map(sourceCard)}
            </div>
            {librarySources.length === 0 && (
              <div className="bf-empty">
                <Layers />
                <h2>No references here yet.</h2>
                <p>Add a sample reel to guide this format.</p>
                <button onClick={() => setDialog("upload")}>
                  <Upload />
                  Add reference
                </button>
              </div>
            )}
            {librarySources.length > sourceLimit && (
              <button
                className="bf-load-more"
                onClick={() => setSourceLimit((n) => n + 18)}
              >
                Show more references
              </button>
            )}
          </>
        ) : (
          <>
            <div className="bf-page-heading">
              <div>
                <div className="bf-eyebrow">
                  {initialView === "saved"
                    ? "YOUR SHORTLIST / " + kept + " KEPT"
                    : "YOUR NEXT REELS"}
                </div>
                <h1>{title}</h1>
                <p>
                  {initialView === "saved"
                    ? "Ideas worth making. Keep exploring before you produce."
                    : "Relatable moments. Fresh formats. Your brand's point of view."}
                </p>
              </div>
              <button
                className="bf-primary"
                disabled={!!busy}
                onClick={() =>
                  void perform("batch", async () => {
                    if (focus !== "all" && focus !== "message")
                      await command({
                        action: "context",
                        context: { ...data.feed.context, productId: focus },
                      });
                    await command({ action: "batch" });
                    await reload();
                    setNotice(
                      "Fresh draft variations prepared from your saved references. No paid generation started.",
                    );
                  })
                }
              >
                {busy === "batch" ? (
                  <LoaderCircle className="bf-spin" />
                ) : (
                  <Plus />
                )}
                {busy === "batch" ? "Preparing ideas" : "Find more ideas"}
              </button>
            </div>
            <section className="bf-agent-note">
              <span className="bf-agent-icon">
                <Sparkles />
              </span>
              <div>
                <h2>A little humour. A little routine. A product spotlight.</h2>
                <p>
                  {data.feed.context.direction ||
                    "A mix of relatable messages and product-led directions. The product only appears when it adds to the idea."}
                </p>
              </div>
              <button className="bf-text-button" onClick={direction}>
                Change direction
                <ArrowUpRight />
              </button>
            </section>
            <div className="bf-toolbar">
              <div className="bf-tabs" role="group" aria-label="Reel source">
                {(["all", "trend", "viral", "product"] as const).map((kind) => (
                  <button
                    key={kind}
                    className={filter === kind ? "active" : ""}
                    aria-pressed={filter === kind}
                    onClick={() => setFilter(kind)}
                  >
                    {kind === "all"
                      ? "All ideas"
                      : kind === "trend"
                        ? "Trend remixes"
                        : kind === "viral"
                          ? "Viral remixes"
                          : "Product remixes"}
                  </button>
                ))}
              </div>
              <label className="bf-focus">
                <span className="bf-sr-only">Product focus</span>
                <select
                  value={focus}
                  onChange={(e) => setFocus(e.target.value)}
                >
                  <option value="all">All brand ideas</option>
                  <option value="message">Message-led only</option>
                  {data.products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="bf-grid">{ideas.map(card)}</div>
            {!ideas.length && (
              <div className="bf-empty">
                <Bookmark />
                <h2>
                  {initialView === "saved"
                    ? "No kept ideas in this view."
                    : "No ideas match this view yet."}
                </h2>
                <p>
                  {initialView === "saved"
                    ? "Keep ideas from your brand feed to build a shortlist."
                    : "Try another filter, prepare more ideas, or add a ready reel reference."}
                </p>
                <div className="bf-detail-actions">
                  {initialView === "saved" ? (
                    <Link href="/" className="bf-button">
                      Explore your ideas
                      <ArrowRight />
                    </Link>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setFilter("all");
                          setFocus("all");
                        }}
                      >
                        Show all ideas
                      </button>
                      <Link href="/reel-library" className="bf-button">
                        Reel library
                        <ArrowRight />
                      </Link>
                    </>
                  )}
                </div>
              </div>
            )}
            <footer className="bf-footer">
              <span>
                <ShieldCheck />
                Draft previews only. Paid footage needs separate approval.
              </span>
              <span>Saved references / No automatic paid generation</span>
            </footer>
          </>
        )}
      </div>
      <dialog
        ref={dialogRef}
        className="bf-dialog"
        onCancel={() => setDialog(null)}
      >
        <div className="bf-dialog-heading">
          <h2>
            {dialog === "direction"
              ? "Give the agent a direction"
              : dialog === "upload"
                ? "Add a reel reference"
                : "Approve this preview"}
          </h2>
          <button
            className="bf-icon"
            aria-label="Close dialog"
            title="Close"
            onClick={() => setDialog(null)}
            disabled={!!busy}
          >
            <X />
          </button>
        </div>
        {dialog === "direction" && context && (
          <form
            className="bf-form"
            onSubmit={(e) => {
              e.preventDefault();
              void perform("context", async () => {
                await command({ action: "context", context });
                await reload();
                setDialog(null);
                setNotice(
                  "Direction saved. Find more ideas to prepare a new batch.",
                );
              });
            }}
          >
            <label className="bf-field">
              Creative direction
              <textarea
                value={context.direction}
                rows={3}
                maxLength={2000}
                placeholder="More relatable skincare humour. Less product pitching."
                onChange={(e) =>
                  setContext({ ...context, direction: e.target.value })
                }
              />
            </label>
            <label className="bf-field">
              Product focus
              <select
                value={context.productId}
                onChange={(e) =>
                  setContext({ ...context, productId: e.target.value })
                }
              >
                <option value="">Across the brand</option>
                {data?.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="bf-field">
              Audience
              <input
                value={context.audience}
                maxLength={2000}
                onChange={(e) =>
                  setContext({ ...context, audience: e.target.value })
                }
              />
            </label>
            <label className="bf-field">
              Brand voice
              <input
                value={context.tone}
                maxLength={300}
                onChange={(e) =>
                  setContext({ ...context, tone: e.target.value })
                }
              />
            </label>
            <label className="bf-field">
              Language
              <select
                value={context.language}
                onChange={(e) =>
                  setContext({
                    ...context,
                    language: e.target.value as FeedContext["language"],
                  })
                }
              >
                <option value="english">English</option>
                <option value="hinglish">Hinglish</option>
              </select>
            </label>
            <label className="bf-field">
              Restrictions
              <textarea
                value={context.restrictions}
                rows={2}
                maxLength={2000}
                onChange={(e) =>
                  setContext({ ...context, restrictions: e.target.value })
                }
              />
            </label>
            <button type="submit" className="bf-primary" disabled={!!busy}>
              {busy ? <LoaderCircle className="bf-spin" /> : <Check />}Save
              direction
            </button>
          </form>
        )}
        {dialog === "upload" && (
          <form
            className="bf-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              void perform("upload", async () => {
                await request("/api/brand-feed/samples", {
                  method: "POST",
                  body: form,
                });
                await reload();
                setDialog(null);
                setNotice("Reference added. Prepare a new batch to use it.");
              });
            }}
          >
            <label className="bf-field">
              Reference title
              <input
                name="title"
                required
                maxLength={130}
                placeholder="Premium product reveal"
              />
            </label>
            <label className="bf-field">
              Reference type
              <select
                name="kind"
                defaultValue={filter === "all" ? "product" : filter}
              >
                <option value="trend">Trend reel</option>
                <option value="viral">Viral reel</option>
                <option value="product">Product reel</option>
              </select>
            </label>
            <label className="bf-field">
              Media file
              <input
                type="file"
                name="file"
                required
                accept="video/mp4,video/webm,image/gif,image/jpeg,image/png,image/webp"
              />
            </label>
            <label className="bf-checkbox">
              <input type="checkbox" name="rights" value="true" required />I
              have permission to use this media as a creative reference.
            </label>
            <p className="bf-small">
              Up to 32 MB. Product references guide the treatment; their product
              is not inserted into your brand&apos;s draft.
            </p>
            <button type="submit" className="bf-primary" disabled={!!busy}>
              {busy ? <LoaderCircle className="bf-spin" /> : <Upload />}Add
              reference
            </button>
          </form>
        )}
        {dialog === "assemble" && selected && (
          <div className="bf-form">
            <dl className="bf-confirm-details">
              <div>
                <dt>Idea</dt>
                <dd>{selected.title}</dd>
              </div>
              <div>
                <dt>Approved version</dt>
                <dd>{selected.revision}</dd>
              </div>
              <div>
                <dt>Production</dt>
                <dd>Existing media / Silent video</dd>
              </div>
              <div>
                <dt>New AI footage</dt>
                <dd>None / 0 Runway credits</dd>
              </div>
            </dl>
            <label className="bf-checkbox">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              I reviewed the visuals, message and timing of this preview.
            </label>
            <button
              className="bf-primary"
              disabled={!!busy || !reviewed}
              onClick={() =>
                void perform("assemble", async () => {
                  await command({
                    action: "assemble",
                    ideaId: selected.id,
                    revision: selected.revision,
                    reviewed: true,
                  });
                  setDialog(null);
                  await reload();
                  window.dispatchEvent(new Event("review-queue-changed"));
                  setNotice("Your video is queued. You can continue browsing.");
                })
              }
            >
              {busy === "assemble" ? (
                <LoaderCircle className="bf-spin" />
              ) : (
                <Clapperboard />
              )}
              {busy === "assemble" ? "Queuing video" : "Approve & assemble"}
            </button>
          </div>
        )}
        {dialog && error && (
          <p className="bf-error" role="alert">
            {error}
          </p>
        )}
      </dialog>
    </div>
  );
}
