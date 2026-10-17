"use client";

import { useRef, Children, type ReactNode } from "react";

/**
 * Real Netflix rows are uniform-size tiles filling left-to-right, with only
 * the hovered tile scaling up (plain CSS :hover, see .netflix-tile in
 * globals.css) — not a continuous "distance from center" scale applied to
 * every tile as you scroll, which is what an earlier version of this
 * component did and which reads as a coverflow, not a Netflix row. That
 * also drops the old per-scroll-frame getBoundingClientRect() pass over
 * every tile, which this component no longer needs.
 *
 * Purely a scroll wrapper — every tile is whatever the caller passes as
 * children, unmodified, so each page keeps its own existing card exactly
 * as-is.
 */
export function NetflixCarousel({ children, onScroll }: { children: ReactNode; onScroll?: () => void }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  // Persists across the mousedown -> mousemove -> mouseup -> click sequence
  // (mouseup fires and clears "active" before the browser's own click event
  // arrives) so a real drag can still suppress the click that follows it —
  // without this, dragging the carousel would also "click" the tile
  // underneath the cursor and pop open its detail view/embed.
  const dragState = useRef({ active: false, startX: 0, startScroll: 0, moved: false });

  const childArray = Children.toArray(children);

  function scrollByPage(dir: 1 | -1) {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollBy({ left: dir * scroller.clientWidth * 0.85, behavior: "smooth" });
  }

  return (
    <div className="netflix-carousel-wrap">
      <button
        type="button"
        className="netflix-arrow netflix-arrow-left"
        onClick={() => scrollByPage(-1)}
        aria-label="Scroll left"
      >
        ‹
      </button>
      <div
        className="netflix-carousel"
        ref={scrollerRef}
        onScroll={onScroll}
        onMouseDown={(e) => {
          dragState.current = { active: true, startX: e.clientX, startScroll: scrollerRef.current!.scrollLeft, moved: false };
          scrollerRef.current!.style.cursor = "grabbing";
        }}
        onMouseMove={(e) => {
          const d = dragState.current;
          const scroller = scrollerRef.current;
          if (!d.active || !scroller) return;
          const dx = e.clientX - d.startX;
          if (Math.abs(dx) > 3) d.moved = true;
          scroller.scrollLeft = d.startScroll - dx;
        }}
        onMouseUp={() => {
          dragState.current.active = false;
          if (scrollerRef.current) scrollerRef.current.style.cursor = "grab";
        }}
        onMouseLeave={() => {
          dragState.current.active = false;
          if (scrollerRef.current) scrollerRef.current.style.cursor = "grab";
        }}
        onClickCapture={(e) => {
          if (dragState.current.moved) {
            e.stopPropagation();
            e.preventDefault();
            dragState.current.moved = false;
          }
        }}
      >
        {childArray.map((child, i) => (
          <div key={i} className="netflix-tile">
            {child}
          </div>
        ))}
      </div>
      <button
        type="button"
        className="netflix-arrow netflix-arrow-right"
        onClick={() => scrollByPage(1)}
        aria-label="Scroll right"
      >
        ›
      </button>
    </div>
  );
}
