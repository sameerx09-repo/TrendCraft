"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { ALL_PERSONAS } from "@/lib/render/personaLibrary";
import { PageHeader } from "../PageHeader";

const ROLES = ["setup", "reveal", "button"] as const;

export default function PersonasPage() {
  const [filter, setFilter] = useState<"all" | "ready">("all");
  const ready = ALL_PERSONAS.filter((persona) => persona.status === "live");
  const visible = filter === "ready" ? ready : ALL_PERSONAS;

  return (
    <div className="page-wide">
      <PageHeader
        title="Persona Library"
        subtitle={
          ready.length +
          " ready personas / " +
          ALL_PERSONAS.length +
          " in library"
        }
      />
      <div className="persona-toolbar">
        <div className="trends-filter-tabs" aria-label="Persona availability">
          <button
            className={filter === "all" ? "trends-tab active" : "trends-tab"}
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            All personas
          </button>
          <button
            className={filter === "ready" ? "trends-tab active" : "trends-tab"}
            aria-pressed={filter === "ready"}
            onClick={() => setFilter("ready")}
          >
            Ready to use
          </button>
        </div>
      </div>
      <div className="persona-tile-grid">
        {visible.map((persona) => {
          const live = persona.status === "live";
          const count = ROLES.reduce(
            (total, role) => total + (persona.clips[role]?.length ?? 0),
            0,
          );
          const content = (
            <div
              className={
                live ? "persona-tile" : "persona-tile persona-tile-incomplete"
              }
            >
              <img
                src={"/" + persona.anchorPhoto}
                alt={persona.label}
                loading="lazy"
              />
              <div className="persona-tile-body">
                <div className="persona-tile-name">
                  {persona.label}
                  {live && <ArrowUpRight aria-hidden="true" />}
                </div>
                <div className="persona-tile-sub">
                  <span>{count} clips</span>
                  <span
                    className={live ? "library-status" : "library-status draft"}
                  >
                    {live ? "Ready" : "In preparation"}
                  </span>
                </div>
              </div>
            </div>
          );
          return live ? (
            <Link key={persona.id} href={"/personas/" + persona.id}>
              {content}
            </Link>
          ) : (
            <div key={persona.id}>{content}</div>
          );
        })}
      </div>
    </div>
  );
}
