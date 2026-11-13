"use client";

export default function CheckError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="sheet space-y-4 rounded-sm px-5 pt-9 pb-7 sm:px-8">
      <p className="font-mono text-xs tracking-[0.14em] text-conflict uppercase">Check failed</p>
      <p className="leading-relaxed text-muted">
        Waybill could not finish reading the sources for this address, so it cannot say whether sending is safe. Do not
        send until a check completes. {error.message}
      </p>
      <button type="button" onClick={reset} className="rounded-sm border border-ink px-5 py-3 font-mono text-sm uppercase">
        Try again
      </button>
    </div>
  );
}
