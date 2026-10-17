"use client";

import Link from "next/link";
import {
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  ArrowUp,
  Check,
  ChevronRight,
  Clapperboard,
  Download,
  FileText,
  Film,
  ImageIcon,
  LoaderCircle,
  MessageSquare,
  Package,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  ScanEye,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  EMPTY_BRIEF,
  ENGINES,
  engineOf,
  statusOf,
  type Brief,
  type Campaign,
  type Engine,
  type PostRow,
  type WorkspaceData,
  type WorkspaceTab,
} from "@/lib/mission-control/types";
import "./mission-control.css";
import PreviewAgent from "./PreviewAgent";

const TABS: [WorkspaceTab, string][] = [
  ["overview", "Overview"],
  ["brief", "Brief"],
  ["remix", "Remix"],
  ["ugc", "AI UGC"],
  ["product", "Product UGC"],
  ["review", "Review"],
  ["activity", "Activity"],
  ["exports", "Exports"],
];
const ENGINE_ICONS = { remix: Shuffle, ugc: Users, product: Package };
type Editor = {
  title: string;
  hook: string;
  reveal: string;
  cta: string;
  caption: string;
  direction: string;
  camera: string;
  lighting: string;
  treatment: string;
  personaId: string;
  trendId: string;
};
const blankEditor: Editor = {
  title: "",
  hook: "",
  reveal: "",
  cta: "",
  caption: "",
  direction:
    "A gentle close-up of the product. Hold the label clearly in frame.",
  camera: "Slow push-in",
  lighting: "Warm vanity light",
  treatment: "Premium reveal",
  personaId: "meera",
  trendId: "",
};
const emptyData: WorkspaceData = {
  campaigns: [],
  posts: [],
  products: [],
  trends: [],
  personas: [],
  brand: { name: "GloVibe", identity: null, toneOfVoice: null },
  mockMode: false,
};
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const raw = await response.text();
  let result;
  try {
    result = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(
      "The server returned an incomplete response. Please try again.",
    );
  }
  if (!response.ok)
    throw new Error(result.error || "Request failed (" + response.status + ")");
  return result as T;
}
const command = <T,>(body: Record<string, unknown>) =>
  json<T>("/api/mission-control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
function Field({ label, children }: { label: string; children: ReactNode }) {
  const labelId = useId();
  return (
    <label className="mc-field-label">
      <span id={labelId}>{label}</span>
      {isValidElement(children)
        ? cloneElement(
            children as ReactElement<{ "aria-labelledby"?: string }>,
            { "aria-labelledby": labelId },
          )
        : children}
    </label>
  );
}
function Poster({
  src,
  fallback,
  alt,
  className = "",
}: {
  src?: string | null;
  fallback?: string | null;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const image = [src, fallback].find(
    (value) => value && !failed.includes(value),
  );
  return image ? (
    <img
      className={className}
      src={image}
      alt={alt}
      loading="lazy"
      onError={() => setFailed((previous) => [...previous, image])}
    />
  ) : (
    <div className={"mc-image-placeholder " + className}>
      <ImageIcon aria-hidden="true" />
      <span>{alt}</span>
    </div>
  );
}
function date(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function fileName(value: string) {
  return value.replace(/[^a-z0-9-]+/gi, "-").slice(0, 100);
}
export default function MissionControl() {
  const [data, setData] = useState<WorkspaceData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<WorkspaceTab>("overview");
  const [mode, setMode] = useState<"workspace" | "agent">("workspace");
  const [campaignId, setCampaignId] = useState("");
  const [brief, setBrief] = useState<Brief>({ ...EMPTY_BRIEF });
  const [editors, setEditors] = useState<Record<Engine, Editor>>({
    remix: { ...blankEditor },
    ugc: { ...blankEditor },
    product: { ...blankEditor },
  });
  const [filter, setFilter] = useState("all");
  const [engineFilter, setEngineFilter] = useState("all");
  const [reviewId, setReviewId] = useState("");
  const [inspector, setInspector] = useState("details");
  const [copy, setCopy] = useState({
    caption: "",
    hashtags: "",
    beats: ["", "", ""],
  });
  const [notes, setNotes] = useState("");
  const [checks, setChecks] = useState({
    packaging: false,
    motion: false,
    brand: false,
  });
  const [scene, setScene] = useState<"hook" | "reveal" | "cta">("hook");
  const [direction, setDirection] = useState("");
  const [busy, setBusy] = useState("");
  const [modal, setModal] = useState<
    | { kind: "campaign" }
    | { kind: "render"; postId: string }
    | { kind: "discard"; postId: string }
    | null
  >(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const loadVersion = useRef(0);
  const initialized = useRef(false);
  const campaign = data.campaigns.find((c) => c.id === campaignId);
  const product = data.products.find((p) => p.id === brief.productId);
  const readyTrends = data.trends.filter((t) => t.readyForRemix);
  const creativeRecord = useCallback(
    (id: string) =>
      data.campaigns.flatMap((c) => c.creatives).find((c) => c.postId === id),
    [data.campaigns],
  );
  const rows = useMemo(
    () =>
      campaign
        ? data.posts.filter((p) =>
            campaign.creatives.some((c) => c.postId === p.post.id),
          )
        : data.posts,
    [data.posts, campaign],
  );
  const selected = data.posts.find((p) => p.post.id === reviewId) || null;
  const selectedRecord = selected
    ? creativeRecord(selected.post.id)
    : undefined;
  const owner = selected
    ? data.campaigns.find((c) =>
        c.creatives.some((r) => r.postId === selected.post.id),
      )
    : undefined;
  const activeJobs = data.campaigns.some((c) =>
    c.creatives.some((r) => r.state === "queued" || r.state === "rendering"),
  );
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      const next = await json<WorkspaceData>("/api/mission-control");
      if (version !== loadVersion.current) return;
      setData(next);
      setError("");
      if (!initialized.current) {
        setMode(
          new URL(window.location.href).searchParams.get("producer") ===
            "preview"
            ? "agent"
            : "workspace",
        );
        initialized.current = true;
        const saved = sessionStorage.getItem("mission-control-campaign");
        const c =
          next.campaigns.find((c) => c.id === saved) || next.campaigns[0];
        if (c) {
          setCampaignId(c.id);
          setBrief({ ...c.brief });
        }
        const savedTab = sessionStorage.getItem("mission-control-tab");
        if (TABS.some(([id]) => id === savedTab))
          setTab(savedTab as WorkspaceTab);
        const persona =
          next.personas.find((p) => p.id === "meera") || next.personas[0];
        if (persona)
          setEditors((prev) => ({
            ...prev,
            ugc: { ...prev.ugc, personaId: persona.id },
          }));
      }
    } catch (e) {
      if (version === loadVersion.current)
        setError(
          e instanceof Error ? e.message : "Workspace could not be loaded",
        );
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timer);
      loadVersion.current++;
    };
  }, [load]);
  useEffect(() => {
    const update = () => void load();
    window.addEventListener("runtime-mode-changed", update);
    return () => window.removeEventListener("runtime-mode-changed", update);
  }, [load]);
  useEffect(() => {
    if (!activeJobs) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 6000);
    return () => clearInterval(timer);
  }, [activeJobs, load]);
  useEffect(() => {
    if (modal) {
      dialog.current?.showModal();
    } else dialog.current?.close();
  }, [modal]);
  function go(next: WorkspaceTab) {
    window.history.replaceState(null, "", "/workspace");
    setTab(next);
    setMode("workspace");
    sessionStorage.setItem("mission-control-mode", "workspace");
    setNotice("");
    sessionStorage.setItem("mission-control-tab", next);
  }
  function chooseCampaign(id: string) {
    setCampaignId(id);
    sessionStorage.setItem("mission-control-campaign", id);
    setBrief({
      ...(data.campaigns.find((c) => c.id === id)?.brief || EMPTY_BRIEF),
    });
    setFilter("all");
    setReviewId("");
    setNotice("");
    setEditors({
      remix: { ...blankEditor },
      ugc: { ...blankEditor, personaId: data.personas[0]?.id || "meera" },
      product: { ...blankEditor },
    });
  }
  function updateEditor(engine: Engine, patch: Partial<Editor>) {
    setEditors((prev) => ({
      ...prev,
      [engine]: { ...prev[engine], ...patch },
    }));
  }
  async function perform(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "This action failed. Please try again.",
      );
    } finally {
      setBusy("");
    }
  }
  async function saveBrief() {
    if (!brief.name.trim()) throw new Error("Give the campaign a name.");
    const result = await command<{ campaign: Campaign }>({
      action:
        modal?.kind === "campaign" ? "create" : campaign ? "brief" : "create",
      campaignId,
      brief,
    });
    setCampaignId(result.campaign.id);
    setBrief(result.campaign.brief);
    sessionStorage.setItem("mission-control-campaign", result.campaign.id);
    setModal(null);
    await load();
    setNotice("Campaign brief saved.");
  }
  function newCampaign() {
    setBrief({ ...EMPTY_BRIEF });
    setModal({ kind: "campaign" });
  }
  async function ensureCampaign() {
    if (campaign) {
      if (brief.productId !== campaign.brief.productId)
        throw new Error("Save the product change in the campaign brief first.");
      return campaign.id;
    }
    if (!brief.productId) throw new Error("Choose a campaign product first.");
    const result = await command<{ campaign: Campaign }>({
      action: "create",
      brief: { ...brief, name: brief.name || product?.title + " campaign" },
    });
    setCampaignId(result.campaign.id);
    setBrief(result.campaign.brief);
    sessionStorage.setItem("mission-control-campaign", result.campaign.id);
    return result.campaign.id;
  }
  async function saveDraft(engine: Engine) {
    const editor = editors[engine];
    const id = await ensureCampaign();
    const result = await command<{ postId: string }>({
      action: "draft",
      campaignId: id,
      engine,
      personaId: editor.personaId,
      trendId: editor.trendId,
      title:
        editor.title ||
        product?.title +
          " / " +
          (engine === "ugc"
            ? "Persona story"
            : engine === "remix"
              ? "Trend remix"
              : editor.treatment),
      beats:
        engine === "product"
          ? [
              editor.hook || product?.title || "Product",
              editor.reveal ||
                brief.message ||
                product?.description?.slice(0, 500) ||
                product?.title ||
                "Product reveal",
              editor.cta || "Explore " + data.brand.name,
            ]
          : [editor.hook, editor.reveal, editor.cta],
      caption: editor.caption,
      creativeDirection: [
        editor.treatment,
        editor.direction,
        "Camera: " + editor.camera + ". Lighting: " + editor.lighting + ".",
        brief.preferences,
      ].join(" "),
    });
    await load();
    setReviewId(result.postId);
    go("overview");
    setNotice("Storyboard saved. Open it to review before generating.");
  }
  function openReview(row: PostRow) {
    setReviewId(row.post.id);
    setCopy({
      caption: row.script.caption || "",
      hashtags: (row.script.hashtags || []).join(" "),
      beats: row.script.beats?.length
        ? row.script.beats.slice(0, 3)
        : [row.script.hook || "", "", ""],
    });
    setNotes(creativeRecord(row.post.id)?.notes || "");
    setChecks({ packaging: false, motion: false, brand: false });
    setInspector("details");
    go("review");
  }
  async function decide(status: "kept" | "discarded") {
    if (!selected) return;
    if (status === "kept" && !selected.post.renderedFileUrl)
      throw new Error(
        "Render this storyboard before keeping the final creative.",
      );
    if (status === "kept" && !Object.values(checks).every(Boolean))
      throw new Error(
        "Complete the three review checks before keeping the creative.",
      );
    await json("/api/posts/" + selected.post.id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await load();
    window.dispatchEvent(new Event("review-queue-changed"));
    setNotice(
      status === "kept"
        ? "Creative kept. It is available in Exports."
        : "Creative discarded.",
    );
    setModal(null);
  }
  async function saveCopy() {
    if (!selected) return;
    await json("/api/scripts/" + selected.script.id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caption: copy.caption,
        hashtags: copy.hashtags.split(/\s+/).filter(Boolean),
        ...(!selected.post.renderedFileUrl ? { slides: copy.beats } : {}),
      }),
    });
    await load();
    setNotice("Creative copy saved.");
  }
  async function preparePlan(requestedEngine?: Engine) {
    const id = await ensureCampaign();
    const result = await command<{ beats: string[] }>({
      action: "plan",
      campaignId: id,
      engine: requestedEngine,
      trendId: requestedEngine === "remix" ? editors.remix.trendId : undefined,
    });
    setEditors(
      (prev) =>
        Object.fromEntries(
          Object.entries(prev).map(([key, value]) => [
            key,
            requestedEngine && key !== requestedEngine
              ? value
              : {
                  ...value,
                  hook: result.beats[0] || "",
                  reveal: result.beats[1] || "",
                  cta: result.beats[2] || "",
                  caption: result.beats.join(" "),
                },
          ]),
        ) as Record<Engine, Editor>,
    );
    await load();
    setNotice(
      "Campaign copy prepared. Choose a creative route to review and save its storyboard.",
    );
  }
  function editCreative() {
    if (!selected) return;
    const engine = selectedRecord?.engine || engineOf(selected);
    if (owner) {
      setCampaignId(owner.id);
      setBrief({ ...owner.brief });
      sessionStorage.setItem("mission-control-campaign", owner.id);
    }
    updateEditor(engine, {
      title:
        (selectedRecord?.title || selected.script.hook || "Creative") +
        " / new version",
      hook: selected.script.beats?.[0] || selected.script.hook || "",
      reveal: selected.script.beats?.[1] || "",
      cta: selected.script.beats?.[2] || "",
      caption: selected.script.caption || "",
      personaId: selected.script.personaId || data.personas[0]?.id || "",
      direction:
        engine === "product"
          ? selected.script.arc || blankEditor.direction
          : blankEditor.direction,
    });
    go(engine);
  }
  async function download(row: PostRow, captionOnly = false) {
    let blob: Blob;
    const title =
      creativeRecord(row.post.id)?.title || row.script.hook || "Creative";
    if (captionOnly)
      blob = new Blob(
        [
          (row.script.caption || "") +
            "\n\n" +
            (row.script.hashtags || []).join(" "),
        ],
        { type: "text/plain" },
      );
    else {
      const response = await fetch(row.post.renderedFileUrl!);
      if (!response.ok) throw new Error("The video could not be downloaded.");
      blob = await response.blob();
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName(title) + (captionOnly ? ".txt" : ".mp4");
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  const filtered = rows.filter(
    (row) =>
      (engineFilter === "all" ||
        (creativeRecord(row.post.id)?.engine || engineOf(row)) ===
          engineFilter) &&
      (filter === "all" ||
        (filter === "review" &&
          statusOf(row, creativeRecord(row.post.id)) === "Needs review") ||
        (filter === "progress" &&
          statusOf(row, creativeRecord(row.post.id)) === "In progress") ||
        (filter === "kept" && row.post.status === "kept") ||
        (filter === "draft" &&
          statusOf(row, creativeRecord(row.post.id)) === "Storyboard draft")),
  );
  const exports = rows.filter(
    (r) => r.post.status === "kept" && r.post.renderedFileUrl,
  );
  const pendingModal =
    modal?.kind === "render"
      ? data.posts.find((r) => r.post.id === modal.postId)
      : null;
  const modalRecord = pendingModal
    ? creativeRecord(pendingModal.post.id)
    : undefined;
  const modalOwner = pendingModal
    ? data.campaigns.find((c) =>
        c.creatives.some((r) => r.postId === pendingModal.post.id),
      )
    : undefined;
  const engine = (
    tab === "remix" || tab === "ugc" || tab === "product" ? tab : "product"
  ) as Engine;
  const e = editors[engine];
  const persona = data.personas.find((p) => p.id === e.personaId);
  const selectedTrend = data.trends.find((t) => t.id === e.trendId);
  function productPicker() {
    return (
      <Field label="Campaign product">
        <select
          className="mc-input"
          value={brief.productId}
          onChange={(e) => {
            setBrief((prev) => ({ ...prev, productId: e.target.value }));
            if (campaign)
              setNotice(
                "Save the brief to apply the product change before generating.",
              );
          }}
        >
          <option value="">Choose a product</option>
          {data.products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  function briefFields() {
    return (
      <div className="mc-form-grid">
        <Field label="Campaign name">
          <input
            className="mc-input"
            required
            maxLength={120}
            value={brief.name}
            onChange={(e) => setBrief({ ...brief, name: e.target.value })}
          />
        </Field>
        {productPicker()}
        <Field label="Campaign goal">
          <input
            className="mc-input"
            value={brief.goal}
            onChange={(e) => setBrief({ ...brief, goal: e.target.value })}
          />
        </Field>
        <Field label="Audience">
          <input
            className="mc-input"
            value={brief.audience}
            onChange={(e) => setBrief({ ...brief, audience: e.target.value })}
          />
        </Field>
        <Field label="Language">
          <select
            className="mc-input"
            value={brief.language}
            onChange={(e) =>
              setBrief({
                ...brief,
                language: e.target.value as Brief["language"],
              })
            }
          >
            <option value="english">English</option>
            <option value="hinglish">Hinglish</option>
          </select>
        </Field>
        <Field label="Tone of voice">
          <select
            className="mc-input"
            value={brief.tone}
            onChange={(e) => setBrief({ ...brief, tone: e.target.value })}
          >
            <option>Warm and conversational</option>
            <option>Minimal and premium</option>
            <option>Playful and direct</option>
          </select>
        </Field>
        <div className="mc-span">
          <Field label="Core message">
            <textarea
              className="mc-input"
              rows={3}
              value={brief.message}
              onChange={(e) => setBrief({ ...brief, message: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Runway credit cap">
          <input
            className="mc-input"
            type="number"
            min={0}
            max={100000}
            value={brief.creditCap}
            onChange={(e) =>
              setBrief({ ...brief, creditCap: Number(e.target.value) })
            }
          />
        </Field>
        <div className="mc-span">
          <Field label="Creative preferences">
            <textarea
              className="mc-input"
              rows={2}
              value={brief.preferences}
              onChange={(e) =>
                setBrief({ ...brief, preferences: e.target.value })
              }
            />
          </Field>
        </div>
      </div>
    );
  }
  function beatFields(engine: Engine) {
    const e = editors[engine];
    return (
      <>
        <Field label="Creative title">
          <input
            className="mc-input"
            value={e.title}
            placeholder="Name this creative"
            onChange={(ev) => updateEditor(engine, { title: ev.target.value })}
          />
        </Field>
        <Field label="Opening hook">
          <textarea
            className="mc-input"
            rows={2}
            value={e.hook}
            placeholder="What stops the scroll?"
            onChange={(ev) => updateEditor(engine, { hook: ev.target.value })}
          />
        </Field>
        <Field label="Product reveal">
          <textarea
            className="mc-input"
            rows={2}
            value={e.reveal}
            placeholder="Introduce the product in your own words"
            onChange={(ev) => updateEditor(engine, { reveal: ev.target.value })}
          />
        </Field>
        <Field label="Closing invitation">
          <input
            className="mc-input"
            value={e.cta}
            placeholder="What should the viewer do next?"
            onChange={(ev) => updateEditor(engine, { cta: ev.target.value })}
          />
        </Field>
      </>
    );
  }
  function draftActions(engine: Engine) {
    return (
      <div className="mc-actions">
        <button
          className="mc-button mc-primary"
          disabled={!!busy}
          onClick={() => void perform("draft", () => saveDraft(engine))}
        >
          {busy === "draft" ? <LoaderCircle className="mc-spin" /> : <Save />}
          Save storyboard
        </button>
        <button
          className="mc-button"
          disabled={!!busy || campaign?.paused}
          onClick={() => void perform("plan", () => preparePlan(engine))}
        >
          <Sparkles />
          {busy === "plan" ? "Preparing copy..." : "Help write the copy"}
        </button>
        <span className="mc-caption">Review before generating</span>
      </div>
    );
  }
  return (
    <div className="mc-workspace">
      <header className="mc-topbar">
        <div className="mc-row">
          <span className="mc-top-title">
            <Sparkles />
            Mission Control
          </span>
          <span className="mc-pill">{data.brand.name}</span>
          <span className="mc-pill">
            {data.mockMode ? "Test mode" : "Live mode"}
          </span>
        </div>
        <div className="mc-segment" aria-label="Campaign mode">
          <Link href="/" className="mc-text-button">
            <Sparkles />
            For your brand
          </Link>
          <button
            aria-pressed={mode === "agent"}
            onClick={() => {
              setMode("agent");
              window.history.replaceState(
                null,
                "",
                "/workspace?producer=preview",
              );
            }}
          >
            <Sparkles />
            Preview producer
          </button>
          <button
            aria-pressed={mode === "workspace"}
            onClick={() => {
              setMode("workspace");
              window.history.replaceState(null, "", "/workspace");
              sessionStorage.setItem("mission-control-mode", "workspace");
            }}
          >
            <SlidersHorizontal />
            Workspace
          </button>
        </div>
      </header>
      <section className="mc-campaign">
        <div className="mc-row mc-between">
          <div>
            <div className="mc-eyebrow">
              Campaigns <ChevronRight />{" "}
              {campaign ? "Campaign workspace" : "Brand workspace"}
            </div>
            <h1>{campaign?.brief.name || "Brand workspace"}</h1>
          </div>
          <div className="mc-row">
            <select
              className="mc-input mc-campaign-select"
              aria-label="Select campaign"
              value={campaignId}
              onChange={(e) => chooseCampaign(e.target.value)}
            >
              <option value="">All creatives</option>
              {data.campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.brief.name}
                </option>
              ))}
            </select>
            <button className="mc-button" onClick={newCampaign}>
              <Plus />
              New campaign
            </button>
          </div>
        </div>
        <div className="mc-briefline">
          <div className="mc-row">
            {product && (
              <Poster
                src={product.imageUrl}
                alt={product.title}
                className="mc-thumb"
              />
            )}
            <div>
              <strong>{product?.title || "Your brand content"}</strong>
              <small>
                {campaign
                  ? "Campaign product"
                  : "Existing creatives across all campaigns"}
              </small>
            </div>
          </div>
          <div>
            <small>Campaign goal</small>
            <strong>
              {brief.goal || "Choose a campaign or create a new brief"}
            </strong>
            <small>{brief.audience || data.brand.name}</small>
          </div>
          <div>
            <small>{campaign ? "Language / Runway cap" : "Library"}</small>
            <strong>
              {campaign
                ? (brief.language === "english" ? "English" : "Hinglish") +
                  " / " +
                  brief.creditCap +
                  " credits"
                : data.posts.length + " creatives"}
            </strong>
            {campaign && (
              <button className="mc-text-button" onClick={() => go("brief")}>
                <Pencil />
                Edit brief
              </button>
            )}
          </div>
        </div>
      </section>
      {error && (
        <div className="mc-alert" role="alert">
          <span>{error}</span>
          <button className="mc-button" onClick={() => void load()}>
            <RefreshCw />
            Retry
          </button>
          <button
            className="mc-icon-button"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <X />
          </button>
        </div>
      )}
      {notice && (
        <div className="mc-notice" role="status">
          <Check />
          {notice}
          <button
            className="mc-icon-button"
            aria-label="Dismiss message"
            onClick={() => setNotice("")}
          >
            <X />
          </button>
        </div>
      )}
      {mode === "workspace" ? (
        <>
          <nav
            className="mc-tabs"
            role="tablist"
            aria-label="Campaign workspace"
          >
            {TABS.map(([id, label]) => (
              <button
                key={id}
                id={"mc-tab-" + id}
                role="tab"
                aria-selected={tab === id}
                aria-controls="mc-current-panel"
                tabIndex={tab === id ? 0 : -1}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                    e.preventDefault();
                    const i = TABS.findIndex(([key]) => key === tab);
                    const next =
                      TABS[
                        (i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) %
                          TABS.length
                      ][0];
                    go(next);
                    document.getElementById("mc-tab-" + next)?.focus();
                  }
                }}
                onClick={() => go(id)}
              >
                {label}
                {id === "review" &&
                  rows.some(
                    (p) =>
                      statusOf(p, creativeRecord(p.post.id)) === "Needs review",
                  ) && <span className="mc-tab-dot" />}
              </button>
            ))}
          </nav>
          <section
            className="mc-screen"
            id="mc-current-panel"
            role="tabpanel"
            aria-labelledby={"mc-tab-" + tab}
          >
            {loading ? (
              <div className="mc-empty" role="status">
                <LoaderCircle className="mc-spin" />
                <h2>Loading your workspace</h2>
              </div>
            ) : (
              <>
                {tab === "overview" && (
                  <>
                    <div className="mc-row mc-between">
                      <h2>Campaign workspace</h2>
                      <button
                        className="mc-text-button"
                        onClick={() => {
                          setMode("agent");
                          window.history.replaceState(
                            null,
                            "",
                            "/workspace?producer=preview",
                          );
                          sessionStorage.setItem(
                            "mission-control-mode",
                            "agent",
                          );
                        }}
                      >
                        <Sparkles />
                        Ask the campaign agent
                        <ArrowRight />
                      </button>
                    </div>
                    <div className="mc-engine-grid">
                      {(["remix", "ugc", "product"] as Engine[]).map(
                        (engine) => {
                          const Icon = ENGINE_ICONS[engine];
                          return (
                            <button
                              key={engine}
                              className={"mc-engine mc-engine-" + engine}
                              onClick={() => go(engine)}
                            >
                              <Icon />
                              <strong>{ENGINES[engine]}</strong>
                              <span>
                                {engine === "remix"
                                  ? "Adapt a curated reel to your brand"
                                  : engine === "ugc"
                                    ? "Pair a persona with your product story"
                                    : "Make the product the hero"}
                              </span>
                              <ArrowRight className="mc-engine-arrow" />
                            </button>
                          );
                        },
                      )}
                    </div>
                    <div className="mc-row mc-between">
                      <div className="mc-row">
                        <h3>
                          {campaign ? "Campaign creatives" : "All creatives"}
                        </h3>
                        <span className="mc-pill">{rows.length}</span>
                      </div>
                      <div className="mc-row">
                        <select
                          aria-label="Filter by creative engine"
                          className="mc-input mc-small-select"
                          value={engineFilter}
                          onChange={(e) => setEngineFilter(e.target.value)}
                        >
                          <option value="all">All engines</option>
                          <option value="remix">Remix</option>
                          <option value="ugc">AI UGC</option>
                          <option value="product">Product UGC</option>
                        </select>
                        <select
                          aria-label="Filter by creative status"
                          className="mc-input mc-small-select"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        >
                          <option value="all">All statuses</option>
                          <option value="draft">Drafts</option>
                          <option value="review">Needs review</option>
                          <option value="progress">In progress</option>
                          <option value="kept">Kept</option>
                        </select>
                      </div>
                    </div>
                    <div className="mc-creative-grid">
                      {filtered.map((row) => {
                        const record = creativeRecord(row.post.id);
                        const engine = record?.engine || engineOf(row);
                        const stage = statusOf(row, record);
                        const persona = data.personas.find(
                          (p) => p.id === row.script.personaId,
                        );
                        const fallback = persona
                          ? "/" + persona.anchorPhoto
                          : row.trendItem?.thumbnailUrl;
                        return (
                          <article key={row.post.id} className="mc-creative">
                            <button
                              className="mc-creative-image"
                              onClick={() => openReview(row)}
                              aria-label={
                                "Open " +
                                (record?.title || row.script.hook || "creative")
                              }
                            >
                              {stage === "In progress" ? (
                                <div className="mc-job">
                                  <LoaderCircle className="mc-spin" />
                                  <strong>In progress</strong>
                                  <span>
                                    {record?.state === "queued"
                                      ? "Queued for rendering"
                                      : "Rendering creative"}
                                  </span>
                                </div>
                              ) : (
                                <>
                                  <Poster
                                    className="mc-poster"
                                    src={
                                      row.post.renderedFileUrl
                                        ? "/storage/rendered-posts/" +
                                          row.post.id +
                                          "-poster.jpg"
                                        : fallback
                                    }
                                    fallback={fallback}
                                    alt={
                                      record?.title ||
                                      row.script.hook ||
                                      "Creative"
                                    }
                                  />
                                  <span className="mc-poster-label">
                                    {row.post.renderedFileUrl
                                      ? "Generated video"
                                      : "Storyboard"}
                                  </span>
                                </>
                              )}
                            </button>
                            <div className="mc-creative-meta">
                              <span
                                className={
                                  "mc-pill " +
                                  (stage === "Needs review" || stage === "Kept"
                                    ? "mc-green"
                                    : "")
                                }
                              >
                                {stage}
                              </span>
                              <h3>
                                {record?.title ||
                                  row.script.hook ||
                                  "Untitled creative"}
                              </h3>
                              <p className="mc-caption">
                                {engine === "product"
                                  ? "Product UGC"
                                  : engine === "ugc"
                                    ? "AI UGC"
                                    : "Trend remix"}
                                {persona ? " / " + persona.label : ""}
                              </p>
                              <small>{date(row.post.createdAt)}</small>
                              <div className="mc-row">
                                <button
                                  className="mc-button"
                                  onClick={() => openReview(row)}
                                >
                                  {row.post.renderedFileUrl ? (
                                    <>
                                      <ScanEye />
                                      Review
                                    </>
                                  ) : (
                                    <>
                                      <Pencil />
                                      Open draft
                                    </>
                                  )}
                                </button>
                                {row.post.renderedFileUrl && (
                                  <button
                                    className="mc-icon-button"
                                    aria-label="Download video"
                                    title="Download video"
                                    onClick={() =>
                                      void perform("download", () =>
                                        download(row),
                                      )
                                    }
                                  >
                                    <Download />
                                  </button>
                                )}
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                    {!filtered.length && (
                      <div className="mc-empty">
                        <Clapperboard />
                        <h3>
                          {campaign
                            ? "No creatives yet"
                            : "No matching creatives"}
                        </h3>
                        <p>
                          Choose a creation engine to prepare your first
                          storyboard.
                        </p>
                        {!campaign && (
                          <button
                            className="mc-button mc-primary"
                            onClick={newCampaign}
                          >
                            <Plus />
                            Create a campaign
                          </button>
                        )}
                      </div>
                    )}
                    {campaign?.activity[0] && (
                      <div className="mc-activityline">
                        <Sparkles />
                        <span>{campaign.activity[0].message}</span>
                        <button
                          className="mc-text-button"
                          onClick={() => go("activity")}
                        >
                          View activity
                          <ArrowRight />
                        </button>
                      </div>
                    )}
                  </>
                )}
                {tab === "brief" && (
                  <>
                    <div className="mc-row mc-between">
                      <div>
                        <h2>Campaign brief</h2>
                        <p className="mc-caption">
                          Product, audience and creative direction
                        </p>
                      </div>
                      <span className="mc-pill mc-green">
                        Shared across all three engines
                      </span>
                    </div>
                    <div className="mc-editor">
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void perform("brief", saveBrief);
                        }}
                      >
                        {briefFields()}
                        <div className="mc-actions">
                          <button
                            className="mc-button mc-primary"
                            disabled={!!busy}
                            type="submit"
                          >
                            {busy === "brief" ? (
                              <LoaderCircle className="mc-spin" />
                            ) : (
                              <Save />
                            )}
                            {campaign ? "Save brief" : "Create campaign"}
                          </button>
                        </div>
                      </form>
                      <aside className="mc-editor-aside">
                        <h3>Campaign assets</h3>
                        {product ? (
                          <div className="mc-source">
                            <Poster
                              src={product.imageUrl}
                              alt={product.title}
                              className="mc-thumb"
                            />
                            <div>
                              <strong>{product.title}</strong>
                              <small>Product reference</small>
                            </div>
                          </div>
                        ) : (
                          <p className="mc-caption">
                            Choose a product from your catalog.
                          </p>
                        )}
                        <div className="mc-persona-avatars">
                          {data.personas.map((p) => (
                            <Poster
                              key={p.id}
                              src={"/" + p.anchorPhoto}
                              alt={p.label}
                              className="mc-avatar"
                            />
                          ))}
                        </div>
                        <hr />
                        <h3>Brand voice</h3>
                        <p className="mc-caption">
                          {data.brand.toneOfVoice ||
                            "Configure your brand voice in Brand Profile."}
                        </p>
                        <Link className="mc-text-button" href="/brand">
                          Brand Profile
                          <ArrowRight />
                        </Link>
                        <hr />
                        <h3>Generation checkpoints</h3>
                        <p className="mc-caption">
                          Storyboards are saved first. Rendering requires
                          approval, and finished creatives are reviewed before
                          export.
                        </p>
                      </aside>
                    </div>
                  </>
                )}
                {(tab === "remix" || tab === "ugc" || tab === "product") && (
                  <>
                    <div className="mc-row mc-between">
                      <div>
                        <h2>{ENGINES[engine]}</h2>
                        <p className="mc-caption">
                          {product?.title || "Choose a campaign product"} /{" "}
                          {engine === "product"
                            ? "Pure product film"
                            : engine === "ugc"
                              ? "Persona + product cutaway"
                              : "Curated trend adaptation"}
                        </p>
                      </div>
                      <span className="mc-pill">
                        {engine === "product" ? "No persona" : "Storyboard"}
                      </span>
                    </div>
                    <div className="mc-editor">
                      <div className="mc-stack">
                        {productPicker()}
                        {campaign &&
                          brief.productId !== campaign.brief.productId && (
                            <button
                              className="mc-button"
                              onClick={() => void perform("brief", saveBrief)}
                            >
                              <Save />
                              Save product change
                            </button>
                          )}
                        {engine === "remix" && (
                          <>
                            <h3>Choose a ready trend</h3>
                            <div className="mc-trend-list">
                              {readyTrends.map((trend) => (
                                <button
                                  className="mc-trend"
                                  key={trend.id}
                                  aria-pressed={e.trendId === trend.id}
                                  onClick={() =>
                                    updateEditor(engine, { trendId: trend.id })
                                  }
                                >
                                  <div className="mc-trend-mark">
                                    <Shuffle />
                                  </div>
                                  <span>
                                    <strong>
                                      {trend.hookLine ||
                                        trend.title ||
                                        trend.handle ||
                                        "Curated reel"}
                                    </strong>
                                    <small>
                                      {trend.handle || "Viral Trends"} /{" "}
                                      {
                                        (trend.artifacts || []).filter(
                                          (a) => a.status === "uploaded",
                                        ).length
                                      }{" "}
                                      artifacts
                                    </small>
                                  </span>
                                  <ChevronRight />
                                </button>
                              ))}
                            </div>
                            {!readyTrends.length && (
                              <div className="mc-inline-empty">
                                No ready trends yet.{" "}
                                <Link
                                  className="mc-text-button"
                                  href="/viral-trends"
                                >
                                  Manage Viral Trends
                                  <ArrowRight />
                                </Link>
                              </div>
                            )}
                          </>
                        )}
                        {engine === "ugc" && (
                          <>
                            <h3>Choose your persona</h3>
                            <div className="mc-persona-grid">
                              {data.personas.map((p) => (
                                <button
                                  className="mc-persona"
                                  key={p.id}
                                  aria-pressed={e.personaId === p.id}
                                  onClick={() =>
                                    updateEditor(engine, { personaId: p.id })
                                  }
                                >
                                  <Poster
                                    src={"/" + p.anchorPhoto}
                                    alt={p.label}
                                  />
                                  <strong>{p.label}</strong>
                                  <small>Ready clip library</small>
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                        {engine === "product" && (
                          <>
                            <h3>Creative treatment</h3>
                            <div className="mc-treatment-grid">
                              {[
                                "Premium reveal",
                                "Evening ritual",
                                "Packaging detail",
                              ].map((t) => (
                                <button
                                  className="mc-treatment"
                                  key={t}
                                  aria-pressed={e.treatment === t}
                                  onClick={() =>
                                    updateEditor(engine, { treatment: t })
                                  }
                                >
                                  <Sparkles />
                                  {t}
                                </button>
                              ))}
                            </div>
                            <Field label="Creative direction">
                              <textarea
                                className="mc-input"
                                rows={3}
                                value={e.direction}
                                onChange={(ev) =>
                                  updateEditor(engine, {
                                    direction: ev.target.value,
                                  })
                                }
                              />
                            </Field>
                            <div className="mc-form-grid">
                              <Field label="Camera">
                                <select
                                  className="mc-input"
                                  value={e.camera}
                                  onChange={(ev) =>
                                    updateEditor(engine, {
                                      camera: ev.target.value,
                                    })
                                  }
                                >
                                  <option>Slow push-in</option>
                                  <option>Gentle orbit</option>
                                  <option>Locked frame</option>
                                </select>
                              </Field>
                              <Field label="Lighting">
                                <select
                                  className="mc-input"
                                  value={e.lighting}
                                  onChange={(ev) =>
                                    updateEditor(engine, {
                                      lighting: ev.target.value,
                                    })
                                  }
                                >
                                  <option>Warm vanity light</option>
                                  <option>Clean studio light</option>
                                  <option>Soft evening light</option>
                                </select>
                              </Field>
                            </div>
                            <p className="mc-caption">
                              Gen-4.5 / 4 seconds / 9:16 / No text overlays
                            </p>
                          </>
                        )}
                        {engine === "product" ? (
                          <Field label="Creative title">
                            <input
                              className="mc-input"
                              value={e.title}
                              placeholder="Name this product film"
                              onChange={(event) =>
                                updateEditor(engine, {
                                  title: event.target.value,
                                })
                              }
                            />
                          </Field>
                        ) : (
                          beatFields(engine)
                        )}
                      </div>
                      <aside className="mc-editor-aside">
                        {engine === "ugc" ? (
                          <>
                            <div className="mc-row mc-between">
                              <h3>Scene preview</h3>
                              <span className="mc-pill">
                                {scene === "reveal"
                                  ? "Product reference"
                                  : "Persona library clip"}
                              </span>
                            </div>
                            <div className="mc-preview">
                              {scene === "reveal" ? (
                                <Poster
                                  className="mc-preview-image"
                                  src={product?.imageUrl}
                                  alt={product?.title || "Choose a product"}
                                />
                              ) : persona ? (
                                <video
                                  key={persona.id + scene}
                                  src={
                                    "/" +
                                    (scene === "cta"
                                      ? persona.buttonVideo
                                      : persona.setupVideo)
                                  }
                                  poster={"/" + persona.anchorPhoto}
                                  controls
                                  playsInline
                                  preload="none"
                                  aria-label={
                                    persona.label + " " + scene + " clip"
                                  }
                                />
                              ) : (
                                <div className="mc-empty">
                                  <Users />
                                </div>
                              )}
                            </div>
                            <div className="mc-scenes">
                              {(["hook", "reveal", "cta"] as const).map(
                                (s, i) => (
                                  <button
                                    key={s}
                                    aria-pressed={scene === s}
                                    onClick={() => setScene(s)}
                                  >
                                    <span>{i + 1}</span>
                                    {s === "hook"
                                      ? "Opening hook"
                                      : s === "reveal"
                                        ? "Product cutaway"
                                        : "Closing invitation"}
                                    <ChevronRight />
                                  </button>
                                ),
                              )}
                            </div>
                            <p className="mc-caption">
                              Existing persona clips with your captioned story
                              and product image.
                            </p>
                          </>
                        ) : engine === "product" ? (
                          <>
                            <h3>Product storyboard</h3>
                            <div className="mc-preview">
                              <Poster
                                className="mc-preview-image"
                                src={product?.imageUrl}
                                alt={product?.title || "Choose a product"}
                              />
                            </div>
                            <h3 className="mc-section-gap">{e.treatment}</h3>
                            <p className="mc-caption">
                              {e.camera} / {e.lighting}
                            </p>
                            <hr />
                            <h3>Shot direction</h3>
                            <p className="mc-caption">{e.direction}</p>
                            <p className="mc-caption mc-section-gap">
                              Reference image shown. Review the generated film
                              after rendering.
                            </p>
                          </>
                        ) : (
                          <>
                            <h3>Source and adaptation</h3>
                            {selectedTrend ? (
                              <>
                                <div className="mc-source">
                                  <Shuffle />
                                  <div>
                                    <strong>
                                      {selectedTrend.hookLine ||
                                        selectedTrend.title ||
                                        "Selected reel"}
                                    </strong>
                                    <small>{selectedTrend.handle}</small>
                                  </div>
                                </div>
                                <a
                                  className="mc-text-button"
                                  target="_blank"
                                  rel="noreferrer"
                                  href={selectedTrend.sourceUrl}
                                >
                                  View original reel
                                  <ArrowRight />
                                </a>
                                <hr />
                                <h3>Source caption</h3>
                                <p className="mc-caption">
                                  {selectedTrend.caption ||
                                    "No caption supplied."}
                                </p>
                                <hr />
                                <h3>Your hook</h3>
                                <p className="mc-script-line">
                                  {e.hook ||
                                    "Write an opening hook or ask the agent for copy."}
                                </p>
                              </>
                            ) : (
                              <div className="mc-empty">
                                <Shuffle />
                                <p>Select a ready trend.</p>
                              </div>
                            )}
                          </>
                        )}
                        <hr />
                        <Field label="Caption">
                          <textarea
                            className="mc-input"
                            rows={3}
                            value={e.caption}
                            onChange={(ev) =>
                              updateEditor(engine, { caption: ev.target.value })
                            }
                          />
                        </Field>
                      </aside>
                    </div>
                    {draftActions(engine)}
                  </>
                )}
                {tab === "review" && (
                  <>
                    <div className="mc-row mc-between">
                      <div>
                        <h2>Creative review</h2>
                        <p className="mc-caption">
                          Inspect the finished video or edit a storyboard
                        </p>
                      </div>
                      <select
                        className="mc-input mc-review-select"
                        aria-label="Creative to review"
                        value={selected?.post.id || ""}
                        onChange={(e) => {
                          const row = data.posts.find(
                            (p) => p.post.id === e.target.value,
                          );
                          if (row) openReview(row);
                        }}
                      >
                        <option value="">Choose a creative</option>
                        {rows.map((row) => (
                          <option key={row.post.id} value={row.post.id}>
                            {creativeRecord(row.post.id)?.title ||
                              row.script.hook ||
                              "Creative"}
                          </option>
                        ))}
                      </select>
                    </div>
                    {selected ? (
                      <>
                        <div className="mc-review-layout">
                          <div>
                            <div className="mc-review-stage">
                              {selected.post.renderedFileUrl ? (
                                <video
                                  key={selected.post.renderedFileUrl}
                                  src={selected.post.renderedFileUrl}
                                  poster={
                                    "/storage/rendered-posts/" +
                                    selected.post.id +
                                    "-poster.jpg"
                                  }
                                  controls
                                  playsInline
                                  preload="metadata"
                                  aria-label="Generated creative"
                                />
                              ) : (
                                <Poster
                                  src={
                                    selected.trendItem?.thumbnailUrl ||
                                    "/" +
                                      data.personas.find(
                                        (p) =>
                                          p.id === selected.script.personaId,
                                      )?.anchorPhoto
                                  }
                                  alt="Storyboard reference"
                                  className="mc-preview-image"
                                />
                              )}
                            </div>
                            <p className="mc-caption">
                              {selected.post.renderedFileUrl
                                ? "Generated video"
                                : "Storyboard reference / Not rendered yet"}
                            </p>
                            {selectedRecord?.error && (
                              <p className="mc-inline-error">
                                {selectedRecord.error}
                              </p>
                            )}
                          </div>
                          <div>
                            <div className="mc-row mc-between">
                              <h3>
                                {selectedRecord?.title ||
                                  selected.script.hook ||
                                  "Creative"}
                              </h3>
                              <span className="mc-pill mc-green">
                                {statusOf(selected, selectedRecord)}
                              </span>
                            </div>
                            <div
                              className="mc-segment mc-section-gap"
                              aria-label="Creative inspection"
                            >
                              {["details", "copy", "history"].map((value) => (
                                <button
                                  key={value}
                                  aria-pressed={inspector === value}
                                  onClick={() => setInspector(value)}
                                >
                                  {value[0].toUpperCase() + value.slice(1)}
                                </button>
                              ))}
                            </div>
                            {inspector === "details" && (
                              <>
                                <dl className="mc-details">
                                  <dt>Creative engine</dt>
                                  <dd>
                                    {
                                      ENGINES[
                                        selectedRecord?.engine ||
                                          engineOf(selected)
                                      ]
                                    }
                                  </dd>
                                  <dt>Product</dt>
                                  <dd>
                                    {selected.script.tags?.[0] ||
                                      data.brand.name}
                                  </dd>
                                  <dt>Created</dt>
                                  <dd>{date(selected.post.createdAt)}</dd>
                                  <dt>Format</dt>
                                  <dd>9:16 / Reels</dd>
                                </dl>
                                {selected.post.renderedFileUrl ? (
                                  <>
                                    <h3>Review checkpoints</h3>
                                    {(
                                      [
                                        [
                                          "packaging",
                                          "Packaging and label look right",
                                        ],
                                        [
                                          "motion",
                                          "Motion and framing look natural",
                                        ],
                                        ["brand", "Fits the brand brief"],
                                      ] as const
                                    ).map(([key, label]) => (
                                      <label className="mc-check" key={key}>
                                        <input
                                          type="checkbox"
                                          checked={checks[key]}
                                          onChange={(e) =>
                                            setChecks({
                                              ...checks,
                                              [key]: e.target.checked,
                                            })
                                          }
                                        />
                                        {label}
                                      </label>
                                    ))}
                                  </>
                                ) : (
                                  <div className="mc-storyboard-copy">
                                    {(selected.script.beats || []).map(
                                      (beat, i) => (
                                        <div key={i}>
                                          <span className="mc-eyebrow">
                                            {[
                                              "Opening hook",
                                              "Product reveal",
                                              "Closing invitation",
                                            ][i] || "Scene"}
                                          </span>
                                          <p>{beat}</p>
                                        </div>
                                      ),
                                    )}
                                  </div>
                                )}
                                <div className="mc-review-note">
                                  <ScanEye />
                                  <span>
                                    {selected.post.renderedFileUrl
                                      ? "Review the label in motion before keeping this creative."
                                      : "Review the storyboard before approving a render."}
                                  </span>
                                </div>
                              </>
                            )}
                            {inspector === "copy" && (
                              <div className="mc-stack mc-section-gap">
                                {!selected.post.renderedFileUrl &&
                                  copy.beats.map((value, i) => (
                                    <Field
                                      key={i}
                                      label={
                                        [
                                          "Opening hook",
                                          "Product reveal",
                                          "Closing line",
                                        ][i] || "Scene"
                                      }
                                    >
                                      <textarea
                                        className="mc-input"
                                        rows={2}
                                        value={value}
                                        onChange={(e) =>
                                          setCopy({
                                            ...copy,
                                            beats: copy.beats.map(
                                              (beat, index) =>
                                                index === i
                                                  ? e.target.value
                                                  : beat,
                                            ),
                                          })
                                        }
                                      />
                                    </Field>
                                  ))}
                                <Field label="Caption">
                                  <textarea
                                    className="mc-input"
                                    rows={3}
                                    value={copy.caption}
                                    onChange={(e) =>
                                      setCopy({
                                        ...copy,
                                        caption: e.target.value,
                                      })
                                    }
                                  />
                                </Field>
                                <Field label="Hashtags">
                                  <input
                                    className="mc-input"
                                    value={copy.hashtags}
                                    onChange={(e) =>
                                      setCopy({
                                        ...copy,
                                        hashtags: e.target.value,
                                      })
                                    }
                                  />
                                </Field>
                                <button
                                  className="mc-button"
                                  disabled={!!busy}
                                  onClick={() => void perform("copy", saveCopy)}
                                >
                                  <Save />
                                  Save copy
                                </button>
                              </div>
                            )}
                            {inspector === "history" && (
                              <div className="mc-history">
                                <div>
                                  <FileText />
                                  <strong>Storyboard created</strong>
                                  <span>{date(selected.post.createdAt)}</span>
                                </div>
                                {selected.post.renderedFileUrl && (
                                  <div>
                                    <Film />
                                    <strong>Rendered video available</strong>
                                    <span>{date(selected.post.updatedAt)}</span>
                                  </div>
                                )}
                                {selectedRecord?.notes && (
                                  <div>
                                    <MessageSquare />
                                    <strong>Revision requested</strong>
                                    <p>{selectedRecord.notes}</p>
                                  </div>
                                )}
                                <p className="mc-caption">
                                  New cuts are saved as separate storyboards.
                                </p>
                              </div>
                            )}
                            <Field label="Revision notes">
                              <textarea
                                className="mc-input"
                                rows={2}
                                value={notes}
                                placeholder="What should change in the next version?"
                                onChange={(e) => setNotes(e.target.value)}
                              />
                            </Field>
                          </div>
                        </div>
                        <div className="mc-actions">
                          {selected.post.renderedFileUrl ? (
                            <button
                              className="mc-button mc-primary"
                              disabled={
                                !!busy || selected.post.status === "kept"
                              }
                              onClick={() =>
                                void perform("decision", () => decide("kept"))
                              }
                            >
                              <Check />
                              {selected.post.status === "kept"
                                ? "Kept"
                                : "Keep creative"}
                            </button>
                          ) : (
                            selectedRecord && (
                              <button
                                className="mc-button mc-primary"
                                disabled={
                                  !!busy ||
                                  ["queued", "rendering"].includes(
                                    selectedRecord.state,
                                  )
                                }
                                onClick={() => {
                                  if (selectedRecord.previewPlanId && owner) {
                                    chooseCampaign(owner.id);
                                    setMode("agent");
                                    window.history.replaceState(
                                      null,
                                      "",
                                      "/workspace?producer=preview",
                                    );
                                    sessionStorage.setItem(
                                      "mission-control-mode",
                                      "agent",
                                    );
                                  } else
                                    setModal({
                                      kind: "render",
                                      postId: selected.post.id,
                                    });
                                }}
                              >
                                <Film />
                                {selectedRecord.previewPlanId
                                  ? "Return to Agent preview"
                                  : selectedRecord.state === "failed"
                                    ? "Review retry"
                                    : "Review generation"}
                              </button>
                            )
                          )}
                          <button
                            className="mc-button"
                            disabled={!!busy || !owner}
                            onClick={() =>
                              void perform("revision", async () => {
                                await command({
                                  action: "revision",
                                  campaignId: owner!.id,
                                  postId: selected.post.id,
                                  notes,
                                });
                                await load();
                                setNotice(
                                  "Revision notes saved. Edit as a new version to prepare another cut.",
                                );
                              })
                            }
                          >
                            <MessageSquare />
                            Request changes
                          </button>
                          <button className="mc-button" onClick={editCreative}>
                            <Pencil />
                            Edit as new version
                          </button>
                          <button
                            className="mc-icon-button"
                            aria-label="Discard creative"
                            title="Discard creative"
                            onClick={() =>
                              setModal({
                                kind: "discard",
                                postId: selected.post.id,
                              })
                            }
                          >
                            <Trash2 />
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="mc-empty">
                        <ScanEye />
                        <h3>Choose a creative to review</h3>
                        <button
                          className="mc-button"
                          onClick={() => go("overview")}
                        >
                          <Clapperboard />
                          Open creatives
                        </button>
                      </div>
                    )}
                  </>
                )}
                {tab === "activity" && (
                  <>
                    <div className="mc-row mc-between">
                      <div>
                        <h2>Agent activity</h2>
                        <p className="mc-caption">
                          Saved directions and generation checkpoints
                        </p>
                      </div>
                      {campaign && (
                        <button
                          className="mc-button"
                          disabled={!!busy}
                          onClick={() =>
                            void perform("pause", async () => {
                              await command({
                                action: "pause",
                                campaignId,
                                paused: !campaign.paused,
                              });
                              await load();
                            })
                          }
                        >
                          {campaign.paused ? <Play /> : <Pause />}
                          {campaign.paused ? "Resume agent" : "Pause agent"}
                        </button>
                      )}
                    </div>
                    {campaign ? (
                      <>
                        <div className="mc-activity-summary">
                          <span className="mc-pill mc-green">
                            {campaign.paused
                              ? "Agent paused"
                              : "Ready for direction"}
                          </span>
                          <span>
                            Runway credits reserved: {campaign.reservedCredits}{" "}
                            / {campaign.brief.creditCap}
                          </span>
                        </div>
                        <p className="mc-caption">
                          Pausing stops new agent plans. Running renders finish.
                        </p>
                        <div className="mc-log">
                          {campaign.activity.map((event) => (
                            <div key={event.id}>
                              <time>{date(event.createdAt)}</time>
                              <Sparkles />
                              <div>
                                <strong>{event.message}</strong>
                                <p>{event.detail}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                        <Field label="Creative direction">
                          <textarea
                            className="mc-input"
                            rows={2}
                            value={direction}
                            onChange={(e) => setDirection(e.target.value)}
                            placeholder="Focus the next batch on the product ritual."
                          />
                        </Field>
                        <button
                          className="mc-button mc-primary mc-section-gap"
                          disabled={!!busy}
                          onClick={() =>
                            void perform("direction", async () => {
                              await command({
                                action: "direction",
                                campaignId,
                                direction,
                              });
                              setDirection("");
                              await load();
                              setNotice(
                                "Direction saved for the next agent plan.",
                              );
                            })
                          }
                        >
                          <ArrowUp />
                          Send direction
                        </button>
                      </>
                    ) : (
                      <div className="mc-empty">
                        <Sparkles />
                        <h3>Choose a campaign to inspect activity</h3>
                        <button
                          className="mc-button mc-primary"
                          onClick={newCampaign}
                        >
                          <Plus />
                          New campaign
                        </button>
                      </div>
                    )}
                  </>
                )}
                {tab === "exports" && (
                  <>
                    <div className="mc-row mc-between">
                      <div>
                        <h2>Campaign exports</h2>
                        <p className="mc-caption">
                          Kept videos and their accompanying copy
                        </p>
                      </div>
                      <span className="mc-pill">{exports.length} ready</span>
                    </div>
                    <div className="mc-exports">
                      {exports.map((row) => (
                        <div className="mc-export-row" key={row.post.id}>
                          <Poster
                            src={
                              "/storage/rendered-posts/" +
                              row.post.id +
                              "-poster.jpg"
                            }
                            fallback={row.trendItem?.thumbnailUrl}
                            alt={row.script.hook || "Creative"}
                            className="mc-thumb"
                          />
                          <div>
                            <h3>
                              {creativeRecord(row.post.id)?.title ||
                                row.script.hook ||
                                "Creative"}
                            </h3>
                            <p className="mc-caption">MP4 / Vertical</p>
                          </div>
                          <div className="mc-row">
                            <button
                              className="mc-button mc-primary"
                              disabled={!!busy}
                              onClick={() =>
                                void perform("download", () => download(row))
                              }
                            >
                              <Download />
                              MP4
                            </button>
                            <button
                              className="mc-button"
                              disabled={!!busy}
                              onClick={() =>
                                void perform("download", () =>
                                  download(row, true),
                                )
                              }
                            >
                              <FileText />
                              Caption
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    {!exports.length && (
                      <div className="mc-empty">
                        <Download />
                        <h3>No kept videos yet</h3>
                        <p>Review a finished creative to add it to Exports.</p>
                        <button
                          className="mc-button"
                          onClick={() => go("overview")}
                        >
                          <ScanEye />
                          Review creatives
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </section>
        </>
      ) : (
        <PreviewAgent
          key={
            (campaign?.id || "new") +
            ":" +
            (campaign?.previewPlan?.id || "empty")
          }
          data={data}
          campaign={campaign}
          reload={load}
          onCreated={(created) => {
            setCampaignId(created.id);
            setBrief({ ...created.brief });
            sessionStorage.setItem("mission-control-campaign", created.id);
          }}
          onReview={openReview}
          onWorkspace={() => go("overview")}
        />
      )}{" "}
      <dialog
        ref={dialog}
        className="mc-dialog"
        onCancel={() => {
          setModal(null);
          if (campaign) setBrief({ ...campaign.brief });
        }}
      >
        <div className="mc-row mc-between">
          <h2>
            {modal?.kind === "campaign"
              ? "New campaign"
              : modal?.kind === "discard"
                ? "Discard creative?"
                : "Review generation"}
          </h2>
          <button
            className="mc-icon-button"
            aria-label="Close dialog"
            onClick={() => {
              setModal(null);
              if (modal?.kind === "campaign")
                setBrief({ ...(campaign?.brief || EMPTY_BRIEF) });
            }}
          >
            <X />
          </button>
        </div>
        {modal?.kind === "campaign" && (
          <form
            className="mc-section-gap"
            onSubmit={(e) => {
              e.preventDefault();
              void perform("brief", saveBrief);
            }}
          >
            {briefFields()}
            <div className="mc-actions">
              <button
                type="submit"
                className="mc-button mc-primary"
                disabled={!!busy}
              >
                {busy === "brief" ? (
                  <LoaderCircle className="mc-spin" />
                ) : (
                  <Plus />
                )}
                Create campaign
              </button>
            </div>
          </form>
        )}
        {modal?.kind === "discard" && (
          <>
            <p className="mc-caption mc-section-gap">
              This creative stays in your history with a discarded status.
            </p>
            <div className="mc-actions">
              <button className="mc-button" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button
                className="mc-button mc-danger"
                disabled={!!busy}
                onClick={() =>
                  void perform("decision", () => decide("discarded"))
                }
              >
                <Trash2 />
                Discard
              </button>
            </div>
          </>
        )}
        {modal?.kind === "render" && pendingModal && (
          <>
            <dl className="mc-details">
              <dt>Creative</dt>
              <dd>{modalRecord?.title || pendingModal.script.hook}</dd>
              <dt>Engine</dt>
              <dd>{ENGINES[modalRecord?.engine || engineOf(pendingModal)]}</dd>
              <dt>Estimated Runway credits</dt>
              <dd>{modalRecord?.engine === "product" ? 48 : 0}</dd>
              <dt>Campaign credit cap</dt>
              <dd>{modalOwner?.brief.creditCap}</dd>
              <dt>Already reserved</dt>
              <dd>{modalOwner?.reservedCredits}</dd>
            </dl>
            <p className="mc-caption">
              {modalRecord?.engine === "product"
                ? "Gen-4.5 / 4 seconds at 12 credits per second. Product rendering uses live Runway credits."
                : "Uses existing media. Copywriting and source analysis may have separate API costs."}
            </p>
            {modalRecord?.engine === "product" && (
              <a
                className="mc-text-button"
                href="https://docs.dev.runwayml.com/guides/pricing/"
                target="_blank"
                rel="noreferrer"
              >
                Runway pricing
                <ArrowRight />
              </a>
            )}
            <div className="mc-actions">
              <button
                className="mc-button mc-primary"
                disabled={!!busy}
                onClick={() =>
                  void perform("render", async () => {
                    await command({
                      action: "render",
                      campaignId: modalOwner?.id,
                      postId: pendingModal.post.id,
                    });
                    setModal(null);
                    await load();
                    go("overview");
                    setNotice(
                      "Creative queued. You can continue working while it renders.",
                    );
                  })
                }
              >
                {busy === "render" ? (
                  <LoaderCircle className="mc-spin" />
                ) : (
                  <Film />
                )}
                Queue creative
              </button>
              <button className="mc-button" onClick={() => setModal(null)}>
                Keep editing
              </button>
            </div>
          </>
        )}
        {modal && error && (
          <p className="mc-inline-error" role="alert">
            {error}
          </p>
        )}
      </dialog>
    </div>
  );
}
