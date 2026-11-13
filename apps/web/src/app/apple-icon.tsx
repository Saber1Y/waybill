import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** The favicon's stamp, drawn large for home screens. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#1d1a14" }}>
        <svg width="150" height="150" viewBox="0 0 32 32">
          <rect x="5" y="6.5" width="22" height="19" rx="3.5" fill="none" stroke="#6fcf8f" strokeWidth="2" transform="rotate(-6 16 16)" />
          <path d="M9.5 11.5l2.6 9 3.9-7.2 3.9 7.2 2.6-9" fill="none" stroke="#fbf8f1" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    ),
    size,
  );
}
