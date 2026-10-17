import type { ReactNode } from "react";

export function PreviewSceneLayout({
  brandName,
  caption,
  children,
}: {
  brandName: string;
  caption: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "#fff",
        fontFamily: "Arial, sans-serif",
      }}
    >
      {children}
      <div
        style={{
          position: "absolute",
          zIndex: 2,
          top: 30,
          left: 30,
          background: "rgba(255,255,255,.94)",
          color: "#24382e",
          padding: "11px 17px",
          fontSize: 21,
          borderRadius: 6,
          lineHeight: 1.4,
        }}
      >
        {brandName}
      </div>
      <div
        style={{
          position: "absolute",
          bottom: "8.5%",
          left: "8%",
          right: "8%",
          color: "#202c29",
          background: "rgba(255,255,255,.96)",
          borderRadius: 6,
          padding: 25,
          fontSize: caption.length > 100 ? 30 : 38,
          lineHeight: 1.4,
          fontWeight: 600,
          textAlign: "center",
          overflowWrap: "anywhere",
          boxShadow: "0 4px 21px rgba(20,44,36,.07)",
        }}
      >
        {caption}
      </div>
    </div>
  );
}
