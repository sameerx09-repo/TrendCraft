"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  Check,
  Clapperboard,
  FileVideo,
  Link as LinkIcon,
  LoaderCircle,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import {
  instagramPostUrl,
  MAX_VIDEO_BYTES,
  VIDEO_MIME_TYPES,
} from "@/lib/engagement/media-policy";
import type {
  EngagementMedia,
  EngagementMediaLibrary,
  EngagementPublishingStatus,
} from "@/lib/engagement/media-types";
import "./engagement-media.css";

export interface MediaSelection {
  media: EngagementMedia | null;
  reelUrl: string;
  publicMediaAvailable: boolean;
}
async function json<T>(url: string, init?: RequestInit): Promise<T> {
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
function Poster({ item }: { item: EngagementMedia }) {
  const [failed, setFailed] = useState(false);
  return item.thumbnailUrl && !failed ? (
    <img
      src={item.thumbnailUrl}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="de-video-placeholder">
      <FileVideo />
    </span>
  );
}
export default function MediaPicker({
  value,
  onChange,
  publishing,
}: {
  value: MediaSelection;
  publishing: EngagementPublishingStatus | null;
  onChange: Dispatch<SetStateAction<MediaSelection>>;
}) {
  const testUrl = publishing?.mockMode ? publishing.testReelUrl : null;
  const [source, setSource] = useState<"generated" | "uploaded" | "paste">(
    value.media?.kind === "uploaded" ? "uploaded" : "generated",
  );
  const [items, setItems] = useState<EngagementMedia[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [limit, setLimit] = useState(6),
    [file, setFile] = useState<File | null>(null),
    [title, setTitle] = useState("");
  const [videoType, setVideoType] = useState("reel"),
    [rights, setRights] = useState(false),
    [uploading, setUploading] = useState(false),
    [localPreview, setLocalPreview] = useState("");
  const initial = useRef(!!value.media),
    version = useRef(0),
    fileInput = useRef<HTMLInputElement>(null),
    objectUrl = useRef("");
  const reload = useCallback(async () => {
    const current = ++version.current;
    setLoading(true);
    setError("");
    try {
      const data = await json<EngagementMediaLibrary>("/api/engagement/media");
      if (current !== version.current) return;
      setItems(data.items);
      const query = new URL(window.location.href).searchParams.get("postId");
      const preferred =
        !initial.current && query
          ? data.items.find((i) => i.id === "post-" + query)
          : null;
      if (!initial.current && query && !preferred)
        setError(
          "That video is not ready or is no longer available. Choose another video.",
        );
      if (preferred) setSource(preferred.kind);
      initial.current = true;
      onChange((previous) => ({
        ...previous,
        publicMediaAvailable: data.publicMediaAvailable,
        media: previous.media
          ? data.items.find((i) => i.id === previous.media!.id) || null
          : preferred || null,
        reelUrl:
          previous.media || previous.reelUrl
            ? previous.reelUrl
            : preferred
              ? testUrl || preferred.publishedUrl
              : "",
      }));
    } catch (e) {
      if (current === version.current)
        setError(
          e instanceof Error ? e.message : "Your videos could not be loaded.",
        );
    } finally {
      if (current === version.current) setLoading(false);
    }
  }, [onChange, testUrl]);
  useEffect(() => {
    const timer = setTimeout(() => void reload(), 0);
    return () => {
      clearTimeout(timer);
      version.current++;
    };
  }, [reload]);
  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );
  function switchSource(next: typeof source) {
    setSource(next);
    setLimit(6);
    setTypeFilter("all");
    setError("");
    onChange((previous) => ({
      ...previous,
      media: null,
      reelUrl: next === "paste" ? testUrl || "" : "",
    }));
  }
  function select(item: EngagementMedia) {
    chooseFile(null);
    if (fileInput.current) fileInput.current.value = "";
    onChange((previous) => ({
      ...previous,
      media: previous.media?.id === item.id ? null : item,
      reelUrl:
        previous.media?.id === item.id ? "" : testUrl || item.publishedUrl,
    }));
    setError("");
  }
  function chooseFile(next: File | null) {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = "";
    setLocalPreview("");
    setFile(null);
    setError("");
    if (!next) return;
    onChange((previous) => ({ ...previous, media: null, reelUrl: "" }));
    if (!VIDEO_MIME_TYPES[next.type]) {
      setError("Use an MP4, WebM or MOV video.");
      return;
    }
    if (!next.size || next.size > MAX_VIDEO_BYTES) {
      setError("Choose a video up to 50 MB.");
      return;
    }
    setFile(next);
    objectUrl.current = URL.createObjectURL(next);
    setLocalPreview(objectUrl.current);
    if (!title) setTitle(next.name.replace(/\.[^.]+$/, "").slice(0, 160));
  }
  async function upload() {
    if (!file || !rights || !title.trim() || uploading) return;
    setUploading(true);
    setError("");
    const form = new FormData();
    form.set("file", file);
    form.set("title", title.trim());
    form.set("rights", "true");
    form.set("videoType", videoType);
    try {
      const result = await json<{ item: EngagementMedia }>(
        "/api/engagement/media/upload",
        { method: "POST", body: form },
      );
      setItems((previous) => [result.item, ...previous]);
      select(result.item);
      setSource("uploaded");
      setTypeFilter("all");
      chooseFile(null);
      setTitle("");
      setRights(false);
      if (fileInput.current) fileInput.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }
  const typeOptions = Array.from(
    new Set(
      items.filter((item) => item.kind === source).map((item) => item.label),
    ),
  );
  const visible = items.filter(
    (item) =>
      item.kind === source &&
      (typeFilter === "all" || item.label === typeFilter),
  );
  const previewUrl =
    source === "uploaded" && localPreview
      ? localPreview
      : value.media?.videoUrl;
  return (
    <div className="de-media-picker">
      <div className="de-tabs" role="group" aria-label="Video source">
        <button
          className={source === "generated" ? "de-tab active" : "de-tab"}
          aria-pressed={source === "generated"}
          disabled={uploading}
          onClick={() => switchSource("generated")}
        >
          <Clapperboard />
          Created videos
        </button>
        <button
          className={source === "uploaded" ? "de-tab active" : "de-tab"}
          aria-pressed={source === "uploaded"}
          disabled={uploading}
          onClick={() => switchSource("uploaded")}
        >
          <Upload />
          Upload your video
        </button>
        <button
          className={source === "paste" ? "de-tab active" : "de-tab"}
          aria-pressed={source === "paste"}
          disabled={uploading}
          onClick={() => switchSource("paste")}
        >
          <LinkIcon />
          Paste any reel link
        </button>
      </div>
      {error && (
        <div className="de-media-error" role="alert">
          {error}
        </div>
      )}
      <div className={"de-media-layout " + (source === "paste" ? "paste" : "")}>
        {source !== "paste" && (
          <section
            className="de-media-library"
            aria-label={
              source === "generated" ? "Created videos" : "Uploaded videos"
            }
          >
            {source === "uploaded" && (
              <form
                className="de-upload-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void upload();
                }}
              >
                <div className="de-upload-fields">
                  <label>
                    Video title
                    <input
                      name="title"
                      disabled={uploading}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      required
                      maxLength={160}
                    />
                  </label>
                  <label>
                    Video type
                    <select
                      aria-label="Video type"
                      disabled={uploading}
                      value={videoType}
                      onChange={(e) => setVideoType(e.target.value)}
                    >
                      <option value="reel">Brand reel</option>
                      <option value="ugc">UGC video</option>
                    </select>
                  </label>
                </div>
                <label>
                  Video file
                  <input
                    ref={fileInput}
                    type="file"
                    accept="video/mp4,video/webm,video/quicktime"
                    onChange={(e) => chooseFile(e.target.files?.[0] || null)}
                    required
                    disabled={uploading}
                  />
                </label>
                <span className="de-media-meta">
                  MP4, WebM or MOV / Up to 50 MB
                </span>
                <label className="de-media-check">
                  <input
                    type="checkbox"
                    disabled={uploading}
                    checked={rights}
                    onChange={(e) => setRights(e.target.checked)}
                    required
                  />
                  I have permission to use this video in a creator campaign.
                </label>
                <button
                  className="btn btn-pri"
                  type="submit"
                  disabled={!file || !rights || !title.trim() || uploading}
                >
                  {uploading ? (
                    <LoaderCircle className="de-media-spin" />
                  ) : (
                    <Upload />
                  )}
                  {uploading ? "Uploading & preparing..." : "Upload video"}
                </button>
              </form>
            )}
            <div className="de-library-heading">
              <h3>
                {source === "generated"
                  ? "Created in TrendCraft"
                  : "Your uploaded videos"}
              </h3>
              {typeOptions.length > 1 && (
                <select
                  aria-label="Video type filter"
                  value={typeFilter}
                  onChange={(e) => {
                    setTypeFilter(e.target.value);
                    setLimit(6);
                  }}
                >
                  <option value="all">All video types</option>
                  {typeOptions.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              )}
              <button
                className="btn btn-sm"
                type="button"
                aria-label="Refresh videos"
                title="Refresh videos"
                disabled={loading || uploading}
                onClick={() => void reload()}
              >
                <RefreshCw />
              </button>
            </div>
            {loading ? (
              <div className="de-media-empty">
                <LoaderCircle className="de-media-spin" />
                Loading your videos...
              </div>
            ) : !visible.length ? (
              <div className="de-media-empty">
                <FileVideo />
                <p>
                  {source === "generated"
                    ? "No completed videos yet."
                    : "No uploaded videos yet."}
                </p>
              </div>
            ) : (
              <div className="de-video-grid">
                {visible.slice(0, limit).map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={
                      "de-video-card " +
                      (value.media?.id === item.id ? "selected" : "")
                    }
                    aria-label={"Choose " + item.title}
                    aria-pressed={value.media?.id === item.id}
                    disabled={uploading}
                    onClick={() => select(item)}
                  >
                    <div className="de-video-poster">
                      <Poster item={item} />
                      {value.media?.id === item.id && (
                        <span className="de-video-selected">
                          <Check />
                        </span>
                      )}
                    </div>
                    <div className="de-video-info">
                      <span className="de-video-label">{item.label}</span>
                      <strong>{item.title}</strong>
                      <span className="de-media-meta">
                        {item.reviewStatus === "kept"
                          ? "Kept video"
                          : "Review before launch"}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {visible.length > limit && (
              <button
                className="btn btn-sm de-show-more"
                onClick={() => setLimit((n) => n + 6)}
              >
                Show more videos
              </button>
            )}
          </section>
        )}
        <section
          className="de-selected-media"
          aria-label="Campaign video and Instagram account"
        >
          {previewUrl ? (
            <>
              <div className="de-selected-heading">
                <button
                  type="button"
                  className="btn btn-sm de-clear-video"
                  aria-label="Unselect video"
                  title="Unselect video"
                  disabled={uploading}
                  onClick={() => {
                    chooseFile(null);
                    if (fileInput.current) fileInput.current.value = "";
                    onChange((previous) => ({
                      ...previous,
                      media: null,
                      reelUrl: "",
                    }));
                  }}
                >
                  <X />
                </button>
                <h3>
                  {localPreview && source === "uploaded"
                    ? "Upload preview"
                    : value.media?.title}
                </h3>
                {value.media && !(localPreview && source === "uploaded") && (
                  <span className="de-video-label">{value.media.label}</span>
                )}
              </div>
              <video
                key={previewUrl}
                src={previewUrl}
                poster={
                  localPreview && source === "uploaded"
                    ? undefined
                    : value.media?.thumbnailUrl || undefined
                }
                controls
                playsInline
                className="de-selected-video"
              />
            </>
          ) : (
            source !== "paste" && (
              <div className="de-media-empty de-selected-empty">
                <FileVideo />
                <p>No video selected</p>
              </div>
            )
          )}
          {publishing?.mockMode ? (
            <div className="de-instagram-status" role="status">
              Test mode / Sample Instagram post
            </div>
          ) : (
            <div className="de-instagram-status" role="status">
              Brand Instagram account /{" "}
              {publishing
                ? publishing.instagramConnected
                  ? "Connected"
                  : "Not connected"
                : "Checking connection..."}
            </div>
          )}
          {(source === "paste" || publishing?.mockMode || value.reelUrl) && (
            <label className="de-published-link">
              {publishing?.mockMode
                ? "Test Instagram URL"
                : "Published Instagram post"}
              <input
                aria-label="Instagram reel URL"
                type="url"
                placeholder="https://www.instagram.com/reel/..."
                value={value.reelUrl}
                readOnly={source !== "paste"}
                onChange={(e) => {
                  const reelUrl = e.target.value;
                  onChange((previous) => ({ ...previous, reelUrl }));
                }}
              />
            </label>
          )}
          {source === "paste" && testUrl && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() =>
                onChange((previous) => ({ ...previous, reelUrl: testUrl }))
              }
            >
              Use test Instagram URL
            </button>
          )}
          {value.reelUrl.trim() && !instagramPostUrl(value.reelUrl) && (
            <p className="de-media-error" role="alert">
              Enter a valid Instagram reel or post link.
            </p>
          )}{" "}
        </section>
      </div>
    </div>
  );
}
