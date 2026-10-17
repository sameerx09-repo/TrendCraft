"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ALL_PERSONAS } from "@/lib/render/personaLibrary";
import { MediaGrid } from "../../MediaGrid";
import { PageHeader } from "../../PageHeader";

const ROLES = ["setup", "reveal", "button"] as const;

export default function PersonaDetailPage() {
  const params = useParams<{ id: string }>();
  const persona = ALL_PERSONAS.find((p) => p.id === params.id);
  if (!persona) {
    return (
      <div>
        <PageHeader title="Persona not found" />
        <div className="empty-state">
          <Link className="btn" href="/personas">
            <ArrowLeft />
            All personas
          </Link>
        </div>
      </div>
    );
  }
  const clips = ROLES.flatMap((role) => persona.clips[role] ?? []);
  return (
    <div className="page-wide">
      <PageHeader
        title={persona.label}
        subtitle={"Persona Library / " + clips.length + " clips"}
        actions={
          <Link href="/personas" className="btn">
            <ArrowLeft aria-hidden="true" />
            All personas
          </Link>
        }
      />
      <div className="persona-detail-summary">
        <img
          className="persona-detail-photo"
          src={"/" + persona.anchorPhoto}
          alt={persona.label}
        />
        <div>
          <div className="persona-tile-name">{persona.label}</div>
          <div className="page-sub">
            {persona.anchorIsRealAnchor
              ? "Character reference"
              : "Clip reference frame"}
          </div>
        </div>
        <span className="library-status">
          {persona.status === "live" ? "Ready to use" : "In preparation"}
        </span>
      </div>
      {clips.length === 0 ? (
        <div className="empty-state">No clips yet.</div>
      ) : (
        <MediaGrid>
          {clips.map((clip) => (
            <div key={clip.videoSrc} className="persona-clip-card">
              <video
                src={"/" + clip.videoSrc}
                controls
                muted
                playsInline
                preload="none"
                poster={"/" + persona.anchorPhoto}
                title={clip.label}
              />
              <div className="persona-clip-label">{clip.label}</div>
            </div>
          ))}
        </MediaGrid>
      )}
    </div>
  );
}
