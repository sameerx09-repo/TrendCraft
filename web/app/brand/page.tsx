"use client";
import { RefreshCw, Save, Check } from "lucide-react";
import { PageHeader } from "../PageHeader";

import { useEffect, useState } from "react";

interface Brand {
  id: string;
  name: string;
  domain: string;
  primaryColor: string | null;
  secondaryColor: string | null;
  hashtags: string[] | null;
  identity: string | null;
  toneOfVoice: string | null;
  targetSegments: string[] | null;
  extractedColors: string[] | null;
  lastAnalyzedAt: string | null;
}
interface Product {
  id: string;
  title: string;
  productType: string | null;
  slotValues: { payoff?: string } | null;
  imageUrl: string | null;
}
interface AngleCount {
  angle: string;
  count: number;
}
interface HashtagCoverage {
  tag: string;
  postCount: number;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function BrandProfilePage() {
  const [brand, setBrand] = useState<Brand | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [angleCounts, setAngleCounts] = useState<AngleCount[]>([]);
  const [hashtagCoverage, setHashtagCoverage] = useState<HashtagCoverage[]>([]);

  const [domainInput, setDomainInput] = useState("");
  const [hashtagsInput, setHashtagsInput] = useState("");
  const [identityInput, setIdentityInput] = useState("");
  const [toneInput, setToneInput] = useState("");
  const [segmentsInput, setSegmentsInput] = useState("");

  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [rescanError, setRescanError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/brand");
      const data = await res.json();
      if (!res.ok || !data.brand)
        throw new Error(data.error ?? "Could not load brand profile");
      setBrand(data.brand);
      setProducts(data.products ?? []);
      setAngleCounts(data.angleCounts ?? []);
      setHashtagCoverage(data.hashtagCoverage ?? []);
      setDomainInput(data.brand.domain ?? "");
      setHashtagsInput((data.brand.hashtags ?? []).join(", "));
      setIdentityInput(data.brand.identity ?? "");
      setToneInput(data.brand.toneOfVoice ?? "");
      setSegmentsInput((data.brand.targetSegments ?? []).join("\n"));
      setLoadError(null);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Could not load brand profile",
      );
    }
  }

  useEffect(() => {
    // The remote request completes before any state is updated.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);
  async function handleSave() {
    if (!brand) return;
    setSaving(true);
    setSaved(false);
    const hashtags = hashtagsInput
      .split(",")
      .map((h) => h.trim().replace(/^#/, ""))
      .filter(Boolean);
    const targetSegments = segmentsInput
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    setSaveError(null);
    try {
      const res = await fetch("/api/brand", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hashtags,
          domain: domainInput.trim(),
          primaryColor: brand.primaryColor,
          secondaryColor: brand.secondaryColor,
          identity: identityInput,
          toneOfVoice: toneInput,
          targetSegments,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.brand)
        throw new Error(data.error ?? "Could not save changes");
      setBrand(data.brand);
      setSaved(true);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Could not save changes",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleRescan() {
    setRescanning(true);
    setRescanError(null);
    try {
      const res = await fetch("/api/brand/analyze", { method: "POST" });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error ?? `re-scan failed (${res.status})`);
      await load();
    } catch (e) {
      setRescanError(e instanceof Error ? e.message : "re-scan failed");
    } finally {
      setRescanning(false);
    }
  }

  if (!brand)
    return (
      <div>
        <PageHeader title="Brand Profile" />
        <div className="empty-state" role="status">
          {loadError ?? "Loading..."}
          {loadError && (
            <button className="btn" onClick={load}>
              Retry
            </button>
          )}
        </div>
      </div>
    );

  return (
    <div onChangeCapture={() => setSaved(false)}>
      <PageHeader
        title="Brand Profile"
        subtitle={brand.name + " / Brand settings"}
        actions={
          <>
            <button
              className="btn"
              onClick={handleRescan}
              disabled={rescanning}
            >
              <RefreshCw aria-hidden="true" />
              {rescanning ? "Scanning..." : "Re-scan site"}
            </button>
            <button
              className="btn btn-pri"
              onClick={handleSave}
              disabled={saving}
            >
              {saved ? (
                <Check aria-hidden="true" />
              ) : (
                <Save aria-hidden="true" />
              )}
              {saving ? "Saving..." : saved ? "Saved" : "Save changes"}
            </button>
          </>
        }
      />
      {saveError && (
        <div
          role="alert"
          className="empty-state"
          style={{ color: "var(--fail)" }}
        >
          {saveError}
        </div>
      )}
      {rescanError && (
        <div
          className="empty-state"
          style={{ color: "var(--fail)", padding: "0 0 16px" }}
        >
          {rescanError}
        </div>
      )}

      <div className="brand-summary">
        <div className="brand-avatar">{brand.name[0]}</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{brand.name}</div>
          <div className="page-sub" style={{ margin: 0 }}>
            {brand.domain} · Synced {timeAgo(brand.lastAnalyzedAt)} ·{" "}
            {products.length} products, {angleCounts.length} angles found
          </div>
        </div>
      </div>

      <div className="brand-grid">
        <div>
          <div className="gcard">
            <label className="glbl" htmlFor="brand-Identity">
              Identity
            </label>
            <div className="page-sub" style={{ fontSize: 11, marginBottom: 6 }}>
              Brand story
            </div>
            <textarea
              id="brand-Identity"
              className="brand-input"
              style={{ minHeight: 52 }}
              value={identityInput}
              onChange={(e) => setIdentityInput(e.target.value)}
            />
          </div>

          <div className="gcard">
            <label className="glbl" htmlFor="brand-tone">
              Tone of voice
            </label>
            <textarea
              id="brand-tone"
              className="brand-input"
              style={{ minHeight: 52 }}
              value={toneInput}
              onChange={(e) => setToneInput(e.target.value)}
            />
          </div>

          <div className="gcard">
            <div className="glbl">Content angles</div>
            <div className="page-sub" style={{ fontSize: 11, marginBottom: 8 }}>
              Creative themes
            </div>
            <div className="cl-skeletons" style={{ marginBottom: 0 }}>
              {angleCounts.length === 0 && (
                <span className="page-sub" style={{ margin: 0 }}>
                  No remixes yet
                </span>
              )}
              {angleCounts.map((a) => (
                <span
                  className="chip chip-lime"
                  key={a.angle}
                  style={{ marginBottom: 0 }}
                >
                  {a.angle} ×{a.count}
                </span>
              ))}
            </div>
          </div>

          <div className="gcard" style={{ marginBottom: 0 }}>
            <div className="glbl">Products</div>
            <div className="page-sub" style={{ fontSize: 11, marginBottom: 8 }}>
              Product catalog
            </div>
            {products.map((p) => (
              <div key={p.id} className="brand-product-row">
                {p.imageUrl && (
                  <img
                    className="brand-product-image"
                    src={p.imageUrl}
                    alt={p.title}
                    loading="lazy"
                  />
                )}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{p.title}</div>
                  {p.slotValues?.payoff && (
                    <div
                      className="page-sub"
                      style={{ margin: 0, fontSize: 11.5 }}
                    >
                      {p.slotValues.payoff}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="gcard">
            <label className="glbl" htmlFor="brand-segments">
              Target segments
            </label>
            <textarea
              id="brand-segments"
              className="brand-input"
              style={{ minHeight: 68 }}
              value={segmentsInput}
              onChange={(e) => setSegmentsInput(e.target.value)}
              placeholder={"One per line, e.g.\nUrban Indian women, 25-40"}
            />
          </div>

          <div className="gcard">
            <div className="glbl">Brand colours</div>
            <div className="page-sub" style={{ fontSize: 11, marginBottom: 8 }}>
              {brand.extractedColors?.length
                ? "Website palette"
                : "No website palette yet"}
            </div>
            {brand.extractedColors && brand.extractedColors.length > 0 && (
              <div className="brand-swatches">
                {brand.extractedColors.map((hex) => (
                  <div key={hex} className="brand-swatch">
                    <div
                      className="brand-swatch-fill"
                      style={{ background: hex }}
                    />
                    <span>{hex}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="glbl" style={{ marginTop: 12 }}>
              Rendering colours
            </div>
            <div className="brand-color-row">
              <input
                aria-label="Primary brand color"
                type="color"
                value={brand.primaryColor ?? "#8a5a2e"}
                onChange={(e) =>
                  setBrand({ ...brand, primaryColor: e.target.value })
                }
              />
              <span className="gval">{brand.primaryColor}</span>
              <input
                aria-label="Secondary brand color"
                type="color"
                value={brand.secondaryColor ?? "#4c6b52"}
                onChange={(e) =>
                  setBrand({ ...brand, secondaryColor: e.target.value })
                }
              />
              <span className="gval">{brand.secondaryColor}</span>
            </div>
          </div>

          <div className="gcard">
            <label className="glbl" htmlFor="brand-Website">
              Website
            </label>
            <input
              id="brand-Website"
              className="brand-input"
              style={{ marginBottom: 4 }}
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
              placeholder="glo-vibe.com"
            />
          </div>

          <div className="gcard" style={{ marginBottom: 0 }}>
            <label className="glbl" htmlFor="brand-hashtags">
              Instagram hashtags
            </label>
            <div className="page-sub" style={{ fontSize: 11, marginBottom: 8 }}>
              Discovery tags
            </div>
            <div className="cl-skeletons" style={{ marginBottom: 8 }}>
              {hashtagCoverage.map((h) => (
                <span
                  className={
                    h.postCount === 0 ? "chip chip-mag" : "chip chip-cyan"
                  }
                  style={{ marginBottom: 0 }}
                  key={h.tag}
                  title={`${h.postCount} post${h.postCount === 1 ? "" : "s"} in your library carry this tag`}
                >
                  #{h.tag} {h.postCount === 0 && "⚠"}
                </span>
              ))}
            </div>
            <input
              id="brand-hashtags"
              className="brand-input"
              style={{ marginBottom: 0 }}
              value={hashtagsInput}
              onChange={(e) => setHashtagsInput(e.target.value)}
              placeholder="skincareindia, indianskincare, ayurveda"
            />
          </div>
        </div>
      </div>

      <button
        className="btn btn-pri"
        style={{ marginTop: 20 }}
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? "Saving…" : saved ? "Saved" : "Save changes"}
      </button>
    </div>
  );
}
