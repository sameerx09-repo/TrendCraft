"use client";
import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { PreviewSceneLayout } from "@/lib/mission-control/PreviewSceneLayout";
import type { RemixScene } from "@/lib/brand-feed/types";
export default function RemixPlayer({
  scenes,
  brandName,
  ideaId,
}: {
  scenes: RemixScene[];
  brandName: string;
  ideaId: string;
}) {
  const [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [scale, setScale] = useState(0.4),
    [failed, setFailed] = useState(false);
  const stage = useRef<HTMLDivElement>(null),
    video = useRef<HTMLVideoElement>(null),
    cursor = useRef(0);
  const total = scenes.reduce((n, s) => n + s.seconds, 0);
  const starts = scenes.map((_, i) =>
    scenes.slice(0, i).reduce((n, s) => n + s.seconds, 0),
  );
  const found = scenes.findIndex((s, i) => time < starts[i] + s.seconds);
  const index = found < 0 ? scenes.length - 1 : found,
    scene = scenes[index];
  const offset = useRef(0);
  useEffect(() => {
    offset.current = Math.max(0, time - starts[index]);
  }, [time, index, starts]);
  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver((e) =>
      setScale(e[0].contentRect.width / 720),
    );
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      cursor.current = Math.min(total, cursor.current + (now - last) / 1000);
      last = now;
      setTime(cursor.current);
      if (cursor.current >= total) setPlaying(false);
    }, 40);
    return () => clearInterval(timer);
  }, [playing, total]);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const sync = () => {
      element.currentTime =
        element.duration > 0
          ? offset.current % element.duration
          : offset.current;
      if (playing) void element.play().catch(() => setPlaying(false));
      else element.pause();
    };
    if (element.readyState >= 1) sync();
    element.addEventListener("loadedmetadata", sync);
    return () => {
      element.removeEventListener("loadedmetadata", sync);
      element.pause();
    };
  }, [index, playing]);
  function seek(next: number) {
    cursor.current = next;
    setTime(next);
    const current = video.current;
    if (current && Number.isFinite(current.duration) && current.duration > 0)
      current.currentTime =
        Math.max(0, next - starts[index]) % current.duration;
  }
  function failure() {
    setFailed(true);
    setPlaying(false);
  }
  if (!scene) return null;
  return (
    <div className="bf-player">
      <div ref={stage} className="bf-stage">
        <div
          className="bf-canvas"
          style={{ transform: "scale(" + scale + ")" }}
        >
          <PreviewSceneLayout brandName={brandName} caption={scene.caption}>
            {scene.type !== "image" ? (
              <video
                key={index}
                ref={video}
                src={
                  scene.type === "gif"
                    ? "/api/brand-feed/preview-media?idea=" +
                      encodeURIComponent(ideaId) +
                      "&scene=" +
                      index
                    : scene.src
                }
                muted
                playsInline
                loop
                preload="auto"
                onLoadedData={() => setReady(true)}
                onError={failure}
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            ) : (
              <img
                src={scene.src}
                alt="Preview visual"
                onLoad={() => setReady(true)}
                onError={failure}
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            )}
          </PreviewSceneLayout>
        </div>
      </div>
      <div className="bf-player-controls">
        <button
          className="bf-icon"
          disabled={failed || !ready}
          aria-label={playing ? "Pause preview" : "Play preview"}
          title={playing ? "Pause" : "Play"}
          onClick={() => {
            if (time >= total) seek(0);
            setPlaying(!playing);
          }}
        >
          {playing ? <Pause /> : <Play />}
        </button>
        <input
          aria-label="Preview position"
          type="range"
          min={0}
          max={total}
          step={0.1}
          value={time}
          disabled={failed || !ready}
          onChange={(e) => seek(Number(e.target.value))}
        />
        <span>
          {Math.floor(time)} / {total}s
        </span>
        <button
          className="bf-icon"
          aria-label="Restart preview"
          title="Restart"
          onClick={() => {
            seek(0);
            setPlaying(false);
          }}
        >
          <RotateCcw />
        </button>
      </div>
      {failed && (
        <p className="bf-error" role="alert">
          This source could not be played. Check the reference in the reel
          library.
        </p>
      )}
      <div className="bf-scene-tabs">
        {scenes.map((s, i) => (
          <button
            key={i}
            className={index === i ? "active" : ""}
            onClick={() => {
              setPlaying(false);
              seek(starts[i]);
            }}
          >
            {scenes.length === 1
              ? "Message"
              : ["Opening", "Message", "Close"][i] || "Scene " + (i + 1)}{" "}
            <span>{s.seconds}s</span>
          </button>
        ))}
      </div>
    </div>
  );
}
