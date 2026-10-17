"use client";

import { useState } from "react";

interface EditableScript {
  id: string;
  slides: string[] | null;
  caption: string | null;
  hashtags: string[] | null;
  angle: string | null;
  hookType: string | null;
  language: string;
}

function gradientFor(key: string): string {
  const GRADIENTS = [
    "linear-gradient(160deg, #4a3c5d, #241f36)",
    "linear-gradient(160deg, #5c3530, #241512)",
    "linear-gradient(160deg, #35503f, #17251d)",
    "linear-gradient(160deg, #4a3a1f, #24190f)",
    "linear-gradient(160deg, #2f4256, #151f2c)",
  ];
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return GRADIENTS[hash % GRADIENTS.length];
}

export function EditModal({
  script,
  canRegenerate,
  onClose,
  onSaved,
}: {
  script: EditableScript;
  canRegenerate: boolean;
  onClose: () => void;
  onSaved: (updated: Partial<EditableScript>) => void;
}) {
  const [slides, setSlides] = useState<string[]>(script.slides?.length ? [...script.slides] : [""]);
  const [caption, setCaption] = useState(script.caption ?? "");
  const [hashtagsText, setHashtagsText] = useState((script.hashtags ?? []).join(" "));
  const [language, setLanguage] = useState<"english" | "hinglish">(
    script.language === "hinglish" ? "hinglish" : "english"
  );
  const [englishCache] = useState({ slides: script.slides?.length ? [...script.slides] : [""], caption: script.caption ?? "" });
  const [hinglishCache, setHinglishCache] = useState<{ slides: string[]; caption: string } | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [translating, setTranslating] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const background = gradientFor(script.angle || script.hookType || script.id);

  async function handleLanguageToggle(next: "english" | "hinglish") {
    if (next === language) return;
    setError(null);
    if (next === "english") {
      setSlides([...englishCache.slides]);
      setCaption(englishCache.caption);
      setLanguage("english");
      return;
    }
    if (hinglishCache) {
      setSlides([...hinglishCache.slides]);
      setCaption(hinglishCache.caption);
      setLanguage("hinglish");
      return;
    }
    setTranslating(true);
    try {
      const res = await fetch(`/api/scripts/${script.id}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: [...slides, caption] }),
      });
      if (!res.ok) throw new Error(`translate failed (${res.status})`);
      const data = await res.json();
      const translatedSlides = data.lines.slice(0, slides.length);
      const translatedCaption = data.lines[slides.length] ?? caption;
      setSlides(translatedSlides);
      setCaption(translatedCaption);
      setHinglishCache({ slides: translatedSlides, caption: translatedCaption });
      setLanguage("hinglish");
    } catch (e) {
      setError(e instanceof Error ? e.message : "translate failed");
    } finally {
      setTranslating(false);
    }
  }

  async function handleRegenerate() {
    setRegenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/scripts/${script.id}/regenerate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `regenerate failed (${res.status})`);
      setSlides(data.script.slides ?? []);
      englishCache.slides = data.script.slides ?? [];
      englishCache.caption = caption;
      setHinglishCache(null);
      setLanguage("english");
    } catch (e) {
      setError(e instanceof Error ? e.message : "regenerate failed");
    } finally {
      setRegenerating(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const hashtags = hashtagsText.split(/\s+/).map((h) => h.trim()).filter(Boolean);
      const res = await fetch(`/api/scripts/${script.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slides, caption, hashtags, language }),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      const data = await res.json();
      onSaved(data.script);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
      setSaving(false);
    }
  }

  function updateSlide(i: number, value: string) {
    setSlides((prev) => prev.map((s, idx) => (idx === i ? value : s)));
  }
  function removeSlide(i: number) {
    if (slides.length <= 1) return;
    setSlides((prev) => prev.filter((_, idx) => idx !== i));
    setPreviewIndex((p) => Math.min(p, slides.length - 2));
  }
  function addSlide() {
    if (slides.length >= 6) return;
    setSlides((prev) => [...prev, ""]);
  }

  const totalSeconds = slides.length * 3.5;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-preview">
          <div className="rc-card rc-card-modal" style={{ background }}>
            <div className="rc-progress">
              {slides.map((_, i) => (
                <span key={i} className={i <= previewIndex ? "rc-progress-fill filled" : "rc-progress-fill"} />
              ))}
            </div>
            <div className="rc-headline">{slides[Math.min(previewIndex, slides.length - 1)] || "…"}</div>
          </div>
          <div className="modal-preview-note">Live preview · renders on keep · ~90s</div>
        </div>

        <div className="modal-body">
          <div className="modal-head">
            <div className="modal-title">Edit this post</div>
            <button className="modal-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
          <div className="modal-sub">
            Changes apply to the script and caption. Visual style — colours, fonts, timing — comes from your Brand
            Profile and applies to every post.
          </div>

          <div className="modal-row">
            <div className="glbl">Language</div>
            {canRegenerate && (
              <button className="btn btn-sm" onClick={handleRegenerate} disabled={regenerating}>
                {regenerating ? "Regenerating…" : "↻ Regenerate script"}
              </button>
            )}
          </div>
          <div className="lang-toggle">
            <button
              className={language === "english" ? "lang-btn active" : "lang-btn"}
              onClick={() => handleLanguageToggle("english")}
            >
              English
            </button>
            <button
              className={language === "hinglish" ? "lang-btn active" : "lang-btn"}
              onClick={() => handleLanguageToggle("hinglish")}
              disabled={translating}
            >
              {translating ? "Translating…" : "Hinglish"}
            </button>
          </div>

          <div className="modal-row" style={{ marginTop: 16 }}>
            <div className="glbl">Slides</div>
            <div className="glbl">
              {slides.length} slides · ~{totalSeconds.toFixed(0)}s
            </div>
          </div>
          {slides.map((slide, i) => (
            <div className="slide-row" key={i}>
              <span className="slide-num">{i + 1}</span>
              <input
                className="brand-input slide-input"
                value={slide}
                onFocus={() => setPreviewIndex(i)}
                onChange={(e) => updateSlide(i, e.target.value)}
              />
              <button className="slide-remove" onClick={() => removeSlide(i)} disabled={slides.length <= 1} aria-label="Remove slide">
                ×
              </button>
            </div>
          ))}
          <button className="btn btn-sm" style={{ marginTop: 4, marginBottom: 16 }} onClick={addSlide}>
            + Add slide
          </button>

          <div className="glbl">Caption</div>
          <textarea
            className="brand-input"
            style={{ minHeight: 64, resize: "vertical" }}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
          />

          <div className="glbl" style={{ marginTop: 12 }}>
            Hashtags
          </div>
          <textarea
            className="brand-input"
            style={{ minHeight: 44, resize: "vertical" }}
            value={hashtagsText}
            onChange={(e) => setHashtagsText(e.target.value)}
            placeholder="#ayurvedicskincare #cleanskincare"
          />

          {error && (
            <div className="page-sub" style={{ color: "var(--fail)", marginTop: 10 }}>
              {error}
            </div>
          )}

          <div className="modal-footer">
            <div className="page-sub" style={{ margin: 0 }}>
              Editing the script re-renders the video when you keep it.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button className="btn btn-pri" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
