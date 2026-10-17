"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Clapperboard,
  ImageIcon,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import {
  EMPTY_BRIEF,
  type Campaign,
  type PostRow,
  type WorkspaceData,
} from "@/lib/mission-control/types";
import type { PreviewConcept } from "@/lib/mission-control/preview-types";
import "./preview-agent.css";
import { PreviewSceneLayout } from "@/lib/mission-control/PreviewSceneLayout";

async function command(body: Record<string, unknown>) {
  const response = await fetch("/api/mission-control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  let result;
  try {
    result = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(
      "The server response was incomplete. No retry was started.",
    );
  }
  if (!response.ok)
    throw new Error(result.error || "The request could not be completed.");
  return result;
}
function RoughCut({
  concept,
  brandName,
  poster,
  onFailure,
}: {
  concept: PreviewConcept;
  brandName: string;
  poster?: string;
  onFailure: (src: string) => void;
}) {
  const [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [seek, setSeek] = useState(0),
    [failed, setFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null),
    clock = useRef(0),
    stage = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver((entries) =>
      setScale(entries[0].contentRect.width / 720),
    );
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);
  const total = concept.scenes.reduce((n, s) => n + s.seconds, 0);
  const starts = concept.scenes.map((_, i) =>
    concept.scenes.slice(0, i).reduce((n, s) => n + s.seconds, 0),
  );
  const found = concept.scenes.findIndex(
    (s, i) => time < starts[i] + s.seconds,
  );
  const index = found < 0 ? concept.scenes.length - 1 : found,
    scene = concept.scenes[index];
  const offset = Math.max(0, time - starts[index]),
    offsetRef = useRef(0);
  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);
  useEffect(() => {
    if (!playing) return;
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      clock.current = Math.min(total, clock.current + (now - previous) / 1000);
      previous = now;
      setTime(clock.current);
      if (clock.current >= total) setPlaying(false);
    }, 40);
    return () => clearInterval(timer);
  }, [playing, total]);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const sync = () => {
      element.currentTime = offsetRef.current;
      if (playing) void element.play().catch(() => setPlaying(false));
      else element.pause();
    };
    if (element.readyState >= 1) sync();
    element.addEventListener("loadedmetadata", sync);
    return () => {
      element.removeEventListener("loadedmetadata", sync);
      element.pause();
    };
  }, [scene.id, playing, seek]);
  function seekTo(value: number) {
    clock.current = value;
    setTime(value);
    setSeek((n) => n + 1);
  }
  function fail() {
    setFailed(true);
    setPlaying(false);
    onFailure(scene.src);
  }
  return (
    <div className="pa-player">
      <div ref={stage} className="pa-stage" aria-label="Silent rough cut">
        <div
          className="pa-canvas"
          style={{ transform: "scale(" + scale + ")" }}
        >
          <PreviewSceneLayout brandName={brandName} caption={scene.caption}>
            {scene.type === "video" ? (
              <video
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  display: "block",
                }}
                key={scene.id}
                ref={video}
                src={scene.src}
                poster={poster}
                muted
                playsInline
                preload="metadata"
                onError={fail}
              />
            ) : (
              <img
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  display: "block",
                }}
                key={scene.id}
                src={scene.src}
                alt="Original product reference"
                onError={fail}
              />
            )}
          </PreviewSceneLayout>
        </div>
        {failed && (
          <div className="pa-asset-error" role="alert">
            An asset could not load. Production is blocked.
          </div>
        )}
      </div>
      <div className="pa-player-controls">
        <button
          className="mc-icon-button"
          aria-label={playing ? "Pause rough cut" : "Play rough cut"}
          title={playing ? "Pause" : "Play"}
          disabled={failed}
          onClick={() => {
            if (time >= total) seekTo(0);
            setPlaying(!playing);
          }}
        >
          {playing ? <Pause /> : <Play />}
        </button>
        <input
          aria-label="Rough cut position"
          type="range"
          min={0}
          max={total}
          step={0.05}
          value={time}
          onChange={(e) => seekTo(Number(e.target.value))}
        />
        <span>
          {Math.floor(time)} / {Math.round(total)}s
        </span>
        <button
          className="mc-icon-button"
          aria-label="Restart rough cut"
          title="Restart"
          onClick={() => {
            seekTo(0);
            setPlaying(false);
          }}
        >
          <RotateCcw />
        </button>
      </div>
      <div className="pa-scenes" aria-label="Preview scenes">
        {concept.scenes.map((s, i) => (
          <button
            key={s.id}
            className={s.id === scene.id ? "pa-scene active" : "pa-scene"}
            aria-pressed={s.id === scene.id}
            onClick={() =>
              seekTo(
                concept.scenes.slice(0, i).reduce((n, c) => n + c.seconds, 0),
              )
            }
          >
            {s.type === "video" ? <Clapperboard /> : <ImageIcon />}
            <span>{["Hook", "Product", "Close"][i]}</span>
            <small>{Math.round(s.seconds)}s</small>
          </button>
        ))}
      </div>
    </div>
  );
}
export default function PreviewAgent({
  data,
  campaign,
  reload,
  onCreated,
  onReview,
  onWorkspace,
}: {
  data: WorkspaceData;
  campaign?: Campaign;
  reload: () => Promise<void>;
  onCreated: (campaign: Campaign) => void;
  onReview: (row: PostRow) => void;
  onWorkspace: () => void;
}) {
  const [productId, setProductId] = useState(""),
    [goal, setGoal] = useState(""),
    [direction, setDirection] = useState(""),
    [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [pilotReviewed, setPilotReviewed] = useState(false);
  const [confirmation, setConfirmation] = useState<"assemble" | "pilot" | null>(
      null,
    ),
    [editing, setEditing] = useState(false),
    [captions, setCaptions] = useState<string[]>([]),
    [failedAssets, setFailedAssets] = useState<string[]>([]);
  const dialog = useRef<HTMLDialogElement>(null),
    pending = useRef(false);
  const plan = campaign?.previewPlan;
  const concept =
    plan?.concepts.find((c) => c.id === selectedId) || plan?.concepts[0];
  const product =
    data.products.find(
      (p) => p.id === (campaign?.brief.productId || productId),
    ) || (!campaign ? data.products[0] : undefined);
  const rendered = data.posts.find((row) => row.post.id === concept?.postId);
  const production = campaign?.creatives.find(
    (c) => c.postId === concept?.postId,
  );
  const pilot = plan?.pilot,
    pilotPost = data.posts.find((row) => row.post.id === pilot?.postId),
    pilotRecord = campaign?.creatives.find((c) => c.postId === pilot?.postId);
  const active = campaign?.creatives.some((c) =>
    ["queued", "rendering"].includes(c.state),
  );
  const stale =
    !!plan &&
    (!plan.reference ||
      JSON.stringify(plan.input.brief) !== JSON.stringify(campaign?.brief) ||
      JSON.stringify(plan.input.directions) !==
        JSON.stringify(campaign?.directions) ||
      plan.input.brandName !== data.brand.name ||
      plan.input.product.imageUrl !== product?.imageUrl ||
      plan.input.product.title !== product?.title ||
      plan.input.product.description !== product?.description);
  const unavailable = concept?.scenes.some((s) => failedAssets.includes(s.src));
  const working = !!busy || !!campaign?.paused;
  useEffect(() => {
    if (confirmation) dialog.current?.showModal();
    else dialog.current?.close();
  }, [confirmation]);
  async function perform(name: string, task: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(name);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The request failed.");
    } finally {
      pending.current = false;
      setBusy("");
    }
  }
  async function prepare(refine = false) {
    let id = campaign?.id;
    if (!id) {
      if (!product) throw new Error("Choose a product first.");
      const result = await command({
        action: "create",
        brief: {
          ...EMPTY_BRIEF,
          name: product.title + " / Launch",
          productId: product.id,
          goal: goal.trim() || "Introduce " + product.title,
          tone: data.brand.toneOfVoice || EMPTY_BRIEF.tone,
        },
      });
      id = result.campaign.id;
      onCreated(result.campaign);
    }
    const result = await command({
      action: refine ? "preview-refine" : "preview-prepare",
      campaignId: id,
      planId: plan?.id,
      direction,
    });
    setSelectedId(result.plan.concepts[0]?.id || "");
    setDirection("");
    await reload();
    setNotice("Previews ready. No Runway generation was requested.");
  }
  function choose(id: string) {
    setSelectedId(id);
    setReviewed(false);
    setPilotReviewed(false);
    setEditing(false);
    setConfirmation(null);
  }
  async function produce() {
    if (!campaign || !plan || !concept) return;
    const result = await command({
      action: confirmation === "pilot" ? "preview-pilot" : "preview-assemble",
      campaignId: campaign.id,
      planId: plan.id,
      conceptId: concept.id,
      reviewed,
      maxCredits: confirmation === "pilot" ? 48 : 0,
    });
    setConfirmation(null);
    await reload();
    setNotice(
      result.alreadyQueued
        ? "This approval already has a production job. No additional attempt was started."
        : confirmation === "pilot"
          ? "One product pilot queued. No automatic paid retries."
          : "Approved edit queued. Existing assets only; 0 Runway credits.",
    );
  }
  const jobInProgress =
    production && ["queued", "rendering"].includes(production.state);
  return (
    <section className="mc-screen pa-agent" data-preview-id={plan?.id || ""}>
      <header className="pa-heading">
        <div>
          <div className="mc-eyebrow">
            <Sparkles />
            Campaign producer
          </div>
          <h2>Preview first. Produce when approved.</h2>
        </div>
        <span className="mc-pill mc-green">
          <ShieldCheck />
          Runway approval required
        </span>
      </header>
      <ol className="pa-steps">
        {["Brief", "Rough cut", "Production", "Review"].map((label, i) => (
          <li
            key={label}
            className={
              (rendered?.post.renderedFileUrl
                ? 3
                : production || pilot
                  ? 2
                  : plan
                    ? 1
                    : 0) === i
                ? "active"
                : ""
            }
          >
            <span>{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {error && (
        <div className="pa-message pa-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="pa-message" role="status">
          {notice}
        </div>
      )}
      {!plan ? (
        <div className="pa-start">
          <div>
            <h3>
              {campaign ? "Your brief is ready" : "What are we creating?"}
            </h3>
            {!campaign && (
              <div className="pa-start-fields">
                <label>
                  Product
                  <select
                    aria-label="Product"
                    className="mc-input"
                    value={product?.id || ""}
                    onChange={(e) => setProductId(e.target.value)}
                  >
                    {data.products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Campaign goal
                  <input
                    className="mc-input"
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    placeholder="Introduce a simple evening ritual"
                  />
                </label>
              </div>
            )}
            {campaign && (
              <p className="mc-caption">
                {campaign.brief.goal || "Introduce " + product?.title}
              </p>
            )}
            <button
              className="mc-button mc-primary"
              disabled={working || !product?.imageUrl}
              onClick={() => void perform("prepare", () => prepare())}
            >
              {busy === "prepare" ? (
                <LoaderCircle className="mc-spin" />
              ) : (
                <Sparkles />
              )}
              Prepare rough cuts
              <ArrowRight />
            </button>
            <p className="pa-cost-note">
              0 Runway credits · Existing assets and catalog copy · Silent
              preview
            </p>
          </div>
          {product?.imageUrl && (
            <img
              className="pa-start-product"
              src={product.imageUrl}
              alt={product.title}
            />
          )}
        </div>
      ) : (
        <>
          <div className="pa-direction-bar">
            <div className="pa-concepts" aria-label="Creative directions">
              {plan.concepts.map((c, i) => (
                <button
                  key={c.id}
                  className={c.id === concept?.id ? "active" : ""}
                  aria-pressed={c.id === concept?.id}
                  onClick={() => choose(c.id)}
                >
                  {c.title}
                  {i === 0 && <span>Recommended</span>}
                </button>
              ))}
            </div>
            <span className="mc-pill">
              {plan.copySource === "ai"
                ? "AI copy draft"
                : "Catalog copy draft"}
            </span>
          </div>
          {concept && (
            <div className="pa-production">
              <div className="pa-preview-column">
                <div className="pa-preview-label">
                  <span>Silent rough cut</span>
                  <span>
                    9:16 ·{" "}
                    {Math.round(
                      concept.scenes.reduce((n, s) => n + s.seconds, 0),
                    )}{" "}
                    seconds
                  </span>
                </div>
                <RoughCut
                  key={plan.id + concept.id}
                  concept={concept}
                  brandName={data.brand.name}
                  poster={
                    data.personas.find((p) => p.id === concept.personaId)
                      ?.anchorPhoto
                      ? "/" +
                        data.personas.find((p) => p.id === concept.personaId)!
                          .anchorPhoto
                      : undefined
                  }
                  onFailure={(src) =>
                    setFailedAssets((previous) =>
                      previous.includes(src) ? previous : [...previous, src],
                    )
                  }
                />
              </div>
              <aside className="pa-decision">
                <div className="pa-recommendation">
                  <h3>{concept.title}</h3>
                  <p>{concept.rationale}</p>
                </div>
                <dl className="pa-facts">
                  <div>
                    <dt>Existing video clips</dt>
                    <dd>
                      {concept.scenes.filter((s) => s.type === "video").length}
                    </dd>
                  </div>
                  <div>
                    <dt>Catalog image beats</dt>
                    <dd>
                      {concept.scenes.filter((s) => s.type === "image").length}
                    </dd>
                  </div>
                  <div>
                    <dt>New Runway generations</dt>
                    <dd>0</dd>
                  </div>
                  <div>
                    <dt>Assembly Runway credits</dt>
                    <dd>0</dd>
                  </div>
                </dl>
                {stale && (
                  <div className="pa-message pa-error">
                    Brief or reference changed. Prepare a fresh preview.
                  </div>
                )}
                <label className="pa-check">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    onChange={(e) => setReviewed(e.target.checked)}
                  />
                  I approve the script, product reference and pacing.
                </label>
                {!concept.postId ? (
                  <button
                    className="mc-button mc-primary pa-full"
                    disabled={working || !reviewed || stale || unavailable}
                    onClick={() => setConfirmation("assemble")}
                  >
                    <Check />
                    Approve &amp; assemble
                  </button>
                ) : (
                  <div className="pa-job" role="status">
                    {rendered?.post.renderedFileUrl ? (
                      <>
                        <Check />
                        Ready for final review
                      </>
                    ) : jobInProgress ? (
                      <>
                        <LoaderCircle className="mc-spin" />
                        Assembling approved assets
                      </>
                    ) : (
                      <>
                        {production?.error ||
                          "Production stopped. Prepare a revised preview before another attempt."}
                      </>
                    )}
                    {rendered?.post.renderedFileUrl && (
                      <button
                        className="mc-button"
                        onClick={() => onReview(rendered)}
                      >
                        <ArrowRight />
                        Review finished edit
                      </button>
                    )}
                  </div>
                )}
                <p className="pa-cost-note">
                  No new generated footage. Local assembly only.
                </p>
                <details className="pa-adjust" open={editing || undefined}>
                  <summary
                    onClick={(e) => {
                      e.preventDefault();
                      if (!editing)
                        setCaptions(concept.scenes.map((s) => s.caption));
                      setEditing(!editing);
                    }}
                  >
                    <SlidersHorizontal />
                    Adjust copy
                  </summary>
                  {editing && (
                    <div className="pa-adjust-fields">
                      {concept.scenes.map((s, i) => (
                        <label key={s.id}>
                          {["Hook", "Product line", "Closing line"][i]}
                          <textarea
                            className="mc-input"
                            rows={2}
                            maxLength={200}
                            value={captions[i] || ""}
                            onChange={(e) =>
                              setCaptions((previous) =>
                                previous.map((v, n) =>
                                  n === i ? e.target.value : v,
                                ),
                              )
                            }
                          />
                        </label>
                      ))}
                      <button
                        className="mc-button"
                        disabled={
                          working || active || captions.some((c) => !c.trim())
                        }
                        onClick={() =>
                          void perform("revise", async () => {
                            await command({
                              action: "preview-revise",
                              campaignId: campaign?.id,
                              planId: plan.id,
                              conceptId: concept.id,
                              captions,
                            });
                            await reload();
                            setEditing(false);
                            setNotice(
                              "Preview revised. Previous approvals no longer apply.",
                            );
                          })
                        }
                      >
                        <Check />
                        Apply to preview
                      </button>
                    </div>
                  )}
                </details>
                <section className="pa-upgrade">
                  <div className="mc-eyebrow">Optional motion upgrade</div>
                  <h3>One product-motion pilot</h3>
                  <p>Gen-4.5 · 4 seconds · Up to 48 credits</p>
                  <p className="pa-cost-note">
                    The rough cut is not a prediction of generated motion. A
                    rejected pilot can still cost credits.
                  </p>
                  {!pilot ? (
                    <button
                      className="mc-button pa-full"
                      disabled={working || !reviewed || stale || unavailable}
                      onClick={() => setConfirmation("pilot")}
                    >
                      <Clapperboard />
                      Review single-shot spending
                    </button>
                  ) : (
                    <div className="pa-job">
                      <strong>
                        {pilotRecord?.state === "complete"
                          ? "Pilot ready for review"
                          : pilotRecord?.state === "failed"
                            ? "Pilot stopped"
                            : "Product pilot in progress"}
                      </strong>
                      <span>
                        {pilot.credits} credits authorized / reserved · One
                        attempt
                      </span>
                      {pilotPost?.post.renderedFileUrl && (
                        <>
                          <video
                            src={pilotPost.post.renderedFileUrl}
                            controls
                            playsInline
                            preload="none"
                          />
                          <label className="pa-check">
                            <input
                              type="checkbox"
                              checked={pilotReviewed}
                              onChange={(e) =>
                                setPilotReviewed(e.target.checked)
                              }
                            />
                            Packaging, motion and brand fit are acceptable.
                          </label>
                          <button
                            className="mc-button"
                            disabled={working || !pilotReviewed}
                            onClick={() =>
                              void perform("use-pilot", async () => {
                                const result = await command({
                                  action: "preview-use-pilot",
                                  campaignId: campaign?.id,
                                  planId: plan.id,
                                  reviewed: pilotReviewed,
                                });
                                await reload();
                                choose(result.conceptId);
                                setNotice(
                                  "Motion edition prepared. Review it before assembly; no additional Runway generation.",
                                );
                              })
                            }
                          >
                            <Check />
                            Use reviewed pilot in an edit
                          </button>
                        </>
                      )}
                      {pilotRecord?.error && (
                        <span className="pa-inline-error">
                          {pilotRecord.error} No automatic retry.
                        </span>
                      )}
                      {pilot.providerTaskId && (
                        <span className="pa-provider-task">
                          Provider task: {pilot.providerTaskId}
                        </span>
                      )}
                    </div>
                  )}
                </section>
              </aside>
            </div>
          )}
          <section className="pa-feedback">
            <div>
              <h3>Another direction?</h3>
              <textarea
                aria-label="Creative feedback"
                className="mc-input"
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                placeholder="Less polished. More everyday. Keep the product visible."
                rows={2}
              />
            </div>
            <div className="pa-feedback-actions">
              <button
                className="mc-button"
                disabled={working || active}
                onClick={() => void perform("prepare", () => prepare())}
              >
                {busy === "prepare" ? (
                  <LoaderCircle className="mc-spin" />
                ) : (
                  <RotateCcw />
                )}
                Revise rough cuts
              </button>
              <button
                className="mc-button"
                disabled={working || active || data.mockMode}
                onClick={() => void perform("refine", () => prepare(true))}
              >
                <Sparkles />
                Refine copy with AI
              </button>
              <span className="pa-cost-note">
                {data.mockMode
                  ? "AI refinement unavailable in Test mode."
                  : "AI copywriting may incur separate API costs."}{" "}
                No Runway generation.
              </span>
            </div>
          </section>
        </>
      )}
      <footer className="pa-footer">
        <span>
          {campaign
            ? campaign.reservedCredits +
              " Runway credits reserved / " +
              campaign.brief.creditCap +
              " campaign cap"
            : "Runway remains off until a specific shot is approved."}
        </span>
        <button className="mc-text-button" onClick={onWorkspace}>
          Open detailed Workspace
          <ArrowRight />
        </button>
      </footer>
      <dialog
        className="mc-dialog pa-dialog"
        ref={dialog}
        onCancel={() => setConfirmation(null)}
      >
        <div className="mc-row mc-between">
          <h2>
            {confirmation === "pilot"
              ? "Authorize one product pilot"
              : "Assemble approved preview"}
          </h2>
          <button
            className="mc-icon-button"
            aria-label="Close production approval"
            onClick={() => setConfirmation(null)}
          >
            <X />
          </button>
        </div>
        <dl className="mc-details">
          <dt>Creative</dt>
          <dd>{concept?.title}</dd>
          <dt>Preview version</dt>
          <dd>{plan?.id.slice(0, 8)}</dd>
          <dt>Production</dt>
          <dd>
            {confirmation === "pilot"
              ? "Gen-4.5 / One 4-second product shot"
              : "Exact approved clips, image and captions"}
          </dd>
          <dt>Runway authorization</dt>
          <dd>
            {confirmation === "pilot"
              ? "Up to 48 credits / One attempt"
              : "0 credits"}
          </dd>
          <dt>Already reserved / Cap</dt>
          <dd>
            {campaign?.reservedCredits} / {campaign?.brief.creditCap}
          </dd>
        </dl>
        {confirmation === "pilot" && data.mockMode && (
          <p className="pa-inline-error">
            Test mode: paid generation is disabled.
          </p>
        )}
        {confirmation === "pilot" && (
          <>
            <p className="mc-caption">
              {
                "Restrained push-in, full label in frame, neutral studio light. No people or hands."
              }
            </p>
            <p className="pa-inline-error">
              Approval does not guarantee a satisfactory result. No automatic
              paid retries. Reserved credits are not a provider billing receipt.
            </p>
          </>
        )}
        {error && (
          <p className="pa-inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="mc-actions">
          <button className="mc-button" onClick={() => setConfirmation(null)}>
            Keep previewing
          </button>
          <button
            className="mc-button mc-primary"
            disabled={
              working ||
              !reviewed ||
              (confirmation === "pilot" && data.mockMode) ||
              (confirmation === "pilot" &&
                (campaign?.reservedCredits || 0) + 48 >
                  (campaign?.brief.creditCap || 0))
            }
            onClick={() => void perform("produce", produce)}
          >
            {busy === "produce" ? (
              <LoaderCircle className="mc-spin" />
            ) : (
              <ShieldCheck />
            )}
            {confirmation === "pilot"
              ? "Authorize 48 credits, one attempt"
              : "Assemble / 0 Runway credits"}
          </button>
        </div>
      </dialog>
    </section>
  );
}
