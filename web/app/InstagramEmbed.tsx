"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    instgrm?: { Embeds: { process: () => void } };
  }
}

/**
 * Instagram's embed.js replaces this element's children (blockquote ->
 * iframe) via direct DOM mutation, outside React's knowledge. Rendering the
 * <blockquote> straight in JSX made React try to remove/diff a node
 * Instagram had already swapped out — "Failed to execute 'removeChild'...
 * not a child of this node", confirmed live on both close and on switching
 * to a different card mid-load. Building the blockquote with
 * document.createElement into a ref'd div that React treats as an opaque
 * leaf (no JSX children) sidesteps that entirely: React only ever
 * mounts/unmounts the wrapper div itself, never touches what Instagram put
 * inside it.
 *
 * Shared between Content Library and Viral Trends — extracted here rather
 * than duplicated, since it's a small piece with a subtle, already-debugged
 * DOM-safety fix worth keeping in one place.
 */
export function InstagramEmbed({ permalink }: { permalink: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Dev-mode Strict Mode runs this effect twice (mount -> simulated
    // cleanup -> mount again) — confirmed live: without this guard, two
    // blockquotes got appended and embed.js hydrated the SAME post twice,
    // stacked in one tile. The guard makes a second invocation a no-op.
    if (el.childElementCount > 0) return;
    const bq = document.createElement("blockquote");
    bq.className = "instagram-media";
    bq.setAttribute("data-instgrm-permalink", permalink);
    bq.setAttribute("data-instgrm-version", "14");
    bq.style.margin = "0";
    bq.style.width = "100%";
    bq.style.minWidth = "0";
    el.appendChild(bq);
    window.instgrm?.Embeds?.process();
    // No cleanup that touches `el`'s children — see comment above. React
    // removing the (empty-to-it) wrapper div on unmount is always safe.
  }, [permalink]);

  // A restricted/private post (confirmed live on a real reel this session —
  // Instagram shows "People under 25 can't see this content" to a
  // logged-out viewer) leaves this iframe stuck at Instagram's tiny default
  // height forever, since embed.js never gets a real resize postMessage
  // back for it. Tried auto-detecting that via a height-after-timeout
  // check and it false-positived on embeds that had genuinely loaded (the
  // real content was visible right underneath the "unavailable" overlay) —
  // not reliable enough to act on, so this is a permanent, low-key hint
  // instead of a conditional judgment call: cheap insurance for the
  // restricted case, harmless for the working case since it just sits
  // below real content nobody needs to read.
  return (
    <div style={{ width: "100%" }}>
      <div ref={ref} style={{ width: "100%" }} />
      <div
        style={{
          fontSize: 12,
          color: "var(--faint)",
          textAlign: "center",
          padding: "4px 8px",
        }}
      >
        Nothing above? This post may be restricted — use &ldquo;View
        source&rdquo; below.
      </div>
    </div>
  );
}

/** Loads Instagram's embed script once per page — call from a top-level
 * useEffect in any page that renders InstagramEmbed. */
export function useInstagramEmbedScript() {
  useEffect(() => {
    if (document.getElementById("ig-embed-script")) return;
    const script = document.createElement("script");
    script.id = "ig-embed-script";
    script.src = "https://www.instagram.com/embed.js";
    script.async = true;
    document.body.appendChild(script);
  }, []);
}
