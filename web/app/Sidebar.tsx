"use client";

import Link from "next/link";
import {
  ChartNoAxesColumnIncreasing,
  Command,
  Bookmark,
  Layers,
  Sparkles,
  Clapperboard,
  TrendingUp,
  Users,
  Download,
  MessageCircle,
  Palette,
  Menu,
  X,
  LogOut,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useBrandSession, useBrand } from "./BrandSession";

// Generate Content (batch remixes from the auto-scraped pool — the exact
// same underlying action as this page's own old "Remix from skeletons"
// button, just wrapped in batch/history UI) is retired: Create Content now
// covers both of its real jobs — brand remix (always from Trends' curated
// reels now) and the new Generate AI UGC workflow. Trend Feed and Viral
// Trends merged into one "Trends" page (still served from /viral-trends —
// the route wasn't renamed, just the page and its content).
const LINKS = [
  { href: "/", label: "For your brand", icon: Sparkles },
  { href: "/kept-reels", label: "Kept reels", icon: Bookmark },
  { href: "/reel-library", label: "Reel library", icon: Layers },
  { href: "/workspace", label: "Workspace", icon: Command },
  {
    href: "/creatives",
    label: "All Creatives",
    badge: true,
    icon: Clapperboard,
  },
  { href: "/viral-trends", label: "Trends", icon: TrendingUp },
  { href: "/personas", label: "Persona Library", icon: Users },
  { href: "/exports", label: "Exports", icon: Download },
  { href: "/drive-engagement", label: "Drive Engagement", icon: MessageCircle },
  { href: "/brand", label: "Brand Profile", icon: Palette },
];

function LogoMark() {
  return <ChartNoAxesColumnIncreasing size={19} aria-hidden="true" />;
}

export function Sidebar() {
  const brand = useBrand(),
    session = useBrandSession();
  const [loggingOut, setLoggingOut] = useState(false);
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [mockMode, setMockMode] = useState<boolean | null>(null);
  const [confirmingLive, setConfirmingLive] = useState(false);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((res) => res.json())
      .then((data) => setMockMode(data.mockMode))
      .catch(() => {});
  }, []);

  // Switching TO live is the one-way-door direction (every real API this
  // app calls — Apify, Runway, HeyGen, every OpenRouter call — starts
  // costing real money the moment this flips) so it needs a deliberate
  // second click; switching back to test is always safe, no confirm
  // needed. Flips the CURRENT server process only — see the route's own
  // comment for why no restart is required, and why it isn't persistent.
  async function setMode(live: boolean) {
    if (live && !confirmingLive) {
      setConfirmingLive(true);
      return;
    }
    setConfirmingLive(false);
    setSwitching(true);
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mockMode: !live }),
    });
    const data = await res.json().catch(() => ({}));
    setSwitching(false);
    if (typeof data.mockMode === "boolean") {
      setMockMode(data.mockMode);
      window.dispatchEvent(new Event("runtime-mode-changed"));
    }
  }

  useEffect(() => {
    function refetch() {
      fetch("/api/review")
        .then((res) => res.json())
        .then((data) => setPendingCount(data.posts?.length ?? 0))
        .catch(() => {});
    }
    refetch();
    // Was [pathname]-only, so the badge froze at whatever count it had
    // when you first landed on "/" and never updated again while you
    // stayed there — confirmed live: Pass/Keep on the last pending post
    // correctly emptied the Review page's own content ("Nothing pending")
    // but the sidebar badge kept showing the stale count, since no route
    // change ever happened to re-trigger this effect. Review's page.tsx
    // dispatches this event after every decide() and loadReview() now.
    //
    // Dropped [pathname] from the deps below after that fix landed — real
    // server timing logs showed /api/review alone taking 1-5s against this
    // project's remote Supabase DB (not local), so re-running it on every
    // single navigation, everywhere in the app, was adding several real
    // seconds to every tab click for a count this event already keeps
    // correct. Runs once on mount now; the event covers every real change.
    window.addEventListener("review-queue-changed", refetch);
    return () => window.removeEventListener("review-queue-changed", refetch);
  }, []);

  return (
    <aside className={mobileOpen ? "sidebar is-open" : "sidebar"}>
      <div className="sidebar-logo">
        <LogoMark />
        <span>trendCraft.ai</span>
        <button
          className="sidebar-mobile-toggle"
          aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={mobileOpen}
          aria-controls="workspace-navigation"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X size={19} /> : <Menu size={19} />}
        </button>
      </div>

      <nav
        id="workspace-navigation"
        aria-label="Workspace navigation"
        className="sidebar-nav"
      >
        {LINKS.map((link) => {
          const active =
            pathname === link.href ||
            (link.href !== "/" && pathname.startsWith(link.href + "/"));
          return (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className={active ? "sidebar-link active" : "sidebar-link"}
              aria-current={active ? "page" : undefined}
            >
              <link.icon size={16} aria-hidden="true" />
              <span>{link.label}</span>
              {link.badge && pendingCount != null && pendingCount > 0 && (
                <span className="sidebar-badge" title="Awaiting review">
                  {pendingCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {mockMode !== null && session?.role === "owner" && (
        <div className="sidebar-mode">
          <div className="sidebar-mode-row">
            <span
              className={`sidebar-mode-dot ${mockMode ? "test" : "live"}`}
            />
            <span className="sidebar-mode-label">
              {mockMode ? "Test mode" : "Live mode"}
            </span>
          </div>
          {confirmingLive ? (
            <div className="sidebar-mode-confirm">
              <div className="sidebar-mode-warn">
                Real API costs (Apify, Runway, HeyGen, OpenRouter) start now.
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  className="btn btn-sm"
                  style={{ flex: 1 }}
                  onClick={() => setConfirmingLive(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-sm btn-pri"
                  style={{ flex: 1 }}
                  disabled={switching}
                  onClick={() => setMode(true)}
                >
                  {switching ? "…" : "Go live"}
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn btn-sm"
              style={{ width: "100%" }}
              disabled={switching}
              // Target "live" is true exactly when currently in test mode
              // (mockMode === true) — i.e. always the opposite of the
              // current state. Passing mockMode directly is correct here,
              // not a coincidence: setMode's `live` param IS "should test
              // mode be off after this", which is exactly what "currently
              // in test" (mockMode) equals when flipping.
              onClick={() => setMode(mockMode === true)}
            >
              {switching
                ? "Switching…"
                : mockMode
                  ? "Switch to live"
                  : "Switch to test"}
            </button>
          )}
        </div>
      )}

      <div className="sidebar-brand">
        <div className="sidebar-brand-name">{brand.name}</div>
        <button
          className="btn btn-sm sidebar-signout"
          title="Sign out"
          aria-label="Sign out"
          disabled={loggingOut}
          onClick={async () => {
            setLoggingOut(true);
            try {
              const response = await fetch("/api/auth/logout", {
                method: "POST",
              });
              if (!response.ok) throw Error("Sign out failed");
              window.location.assign("/login");
            } catch {
              setLoggingOut(false);
            }
          }}
        >
          <LogOut size={16} />
        </button>
        <div className="sidebar-brand-domain">{brand.domain}</div>
      </div>
    </aside>
  );
}
