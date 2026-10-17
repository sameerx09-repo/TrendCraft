"use client";

import { useEffect, useRef, useState } from "react";
import { useBrand } from "./BrandSession";

const STEPS = [
  { key: "reading", label: "Reading your brand website" },
  { key: "instagram", label: "Scouting Instagram" },
  { key: "youtube", label: "Scouting YouTube Shorts" },
  { key: "scoring", label: "Scoring & rewriting for brand" },
] as const;

type StepState = "pending" | "active" | "done" | "error";

/** Riff mock's "WORKING ON GLO-VIBE.COM" onboarding screen — a full-screen
 * takeover showing real pipeline progress, backed by
 * /api/onboarding/run's NDJSON stream (see that route's comment for why
 * this needed a streaming endpoint instead of the Inngest event pattern
 * every other trigger in this app uses). Only 4 real steps, not the mock's
 * 6 — "rendering video" isn't eagerly run here (see the route), and
 * scoring/rewriting is one real combined step in this codebase, not two. */
export function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const brand = useBrand();
  const [states, setStates] = useState<Record<string, StepState>>({});
  const [details, setDetails] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    async function run() {
      const res = await fetch("/api/onboarding/run", { method: "POST" });
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          if (!raw.trim()) continue;
          const evt = JSON.parse(raw);
          if (evt.step === "error") {
            setError(evt.detail);
            continue;
          }
          if (evt.step === "done") {
            setFinished(true);
            continue;
          }
          setStates((prev) => ({ ...prev, [evt.step]: evt.status }));
          if (evt.detail)
            setDetails((prev) => ({ ...prev, [evt.step]: evt.detail }));
        }
      }
    }
    run();
  }, []);

  return (
    <div className="onboard-backdrop">
      <div className="onboard-box">
        <div className="onboard-logo">
          <svg
            width="20"
            height="20"
            viewBox="0 0 18 18"
            fill="none"
            aria-hidden="true"
          >
            <rect
              x="1"
              y="10"
              width="4"
              height="7"
              rx="1"
              fill="var(--accent)"
            />
            <rect
              x="7"
              y="6"
              width="4"
              height="11"
              rx="1"
              fill="var(--accent)"
            />
            <rect
              x="13"
              y="1"
              width="4"
              height="16"
              rx="1"
              fill="var(--accent)"
            />
          </svg>
          <span>trendCraft.ai</span>
        </div>
        <div className="onboard-kicker">
          WORKING ON {brand.domain.toUpperCase()}
        </div>

        <div className="onboard-steps">
          {STEPS.map((s) => {
            const state = states[s.key] ?? "pending";
            return (
              <div className="onboard-step" key={s.key}>
                <span className={`onboard-radio onboard-radio-${state}`}>
                  {state === "done" ? "✓" : ""}
                </span>
                <div>
                  <div
                    className={
                      state === "pending"
                        ? "onboard-step-label dim"
                        : "onboard-step-label"
                    }
                  >
                    {s.label}
                  </div>
                  {details[s.key] && (
                    <div className="onboard-step-detail">{details[s.key]}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {error && (
          <div
            className="page-sub"
            style={{ color: "var(--fail)", marginTop: 16 }}
          >
            {error}
          </div>
        )}

        {(finished || error) && (
          <button
            className="btn btn-pri"
            style={{ marginTop: 24 }}
            onClick={onDone}
          >
            {finished ? "Go to Review" : "Close"}
          </button>
        )}
      </div>
    </div>
  );
}
