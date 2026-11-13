import { ImageResponse } from "next/og";

export const alt = "Waybill: check a NEAR Intents swap before you send, and track every leg after";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PAPER = "#fbf8f1";
const DESK = "#e9e4d8";
const INK = "#1d1a14";
const MUTED = "#6b6455";
const RULE = "#d9d1bf";
const VERIFIED = "#1f6b3a";

// A real swap, every leg verified (packages/core/fixtures/live-tron-trx.json).
const LEGS = [
  { title: "Quote", note: "Signed by 1Click" },
  { title: "Deposit", note: "Read on Tron" },
  { title: "Swap on NEAR Intents", note: "Read on intents.near" },
  { title: "Payout", note: "4,176.64 TRX reached the recipient on Tron" },
];

/** The card X and other sites show for a Waybill link: a waybill sheet, stamped. */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: DESK, padding: 48 }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: PAPER, padding: "44px 56px", position: "relative" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 26, letterSpacing: 8, fontWeight: 700, color: INK }}>WAYBILL</div>
            <div style={{ fontSize: 22, color: MUTED }}>for NEAR Intents swaps</div>
          </div>
          <div style={{ marginTop: 34, fontSize: 64, fontWeight: 700, color: INK, lineHeight: 1.1 }}>Where is my swap?</div>
          <div style={{ marginTop: 14, fontSize: 28, color: MUTED, maxWidth: 600, lineHeight: 1.35 }}>
            Check before you send. Every leg read from the chains. A case file when it stalls.
          </div>
          <div style={{ marginTop: 36, display: "flex", flexDirection: "column", borderTop: `2px solid ${RULE}`, paddingTop: 22 }}>
            {LEGS.map((leg) => (
              <div key={leg.title} style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
                <div style={{ width: 22, height: 22, borderRadius: 11, background: VERIFIED, marginRight: 20 }} />
                <div style={{ fontSize: 26, fontWeight: 700, color: INK, width: 330 }}>{leg.title}</div>
                <div style={{ fontSize: 24, color: MUTED }}>{leg.note}</div>
              </div>
            ))}
          </div>
          <div
            style={{
              position: "absolute",
              right: 60,
              top: 150,
              display: "flex",
              border: `5px solid ${VERIFIED}`,
              borderRadius: 12,
              padding: "10px 26px",
              color: VERIFIED,
              fontSize: 44,
              fontWeight: 700,
              letterSpacing: 6,
              transform: "rotate(-6deg)",
            }}
          >
            DELIVERED
          </div>
        </div>
      </div>
    ),
    size,
  );
}
