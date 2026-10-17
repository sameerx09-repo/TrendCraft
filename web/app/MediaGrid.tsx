import type { ReactNode } from "react";

export function MediaGrid({ children }: { children: ReactNode }) {
  return <div className="media-grid">{children}</div>;
}
