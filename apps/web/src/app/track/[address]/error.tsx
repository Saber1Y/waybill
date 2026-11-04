"use client";

export default function TraceError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="sheet space-y-4 rounded-sm px-5 pt-9 pb-7 sm:px-8">
      <p className="font-mono text-xs tracking-[0.14em] text-conflict uppercase">Trace failed</p>
      <p className="leading-relaxed text-muted">
        Waybill could not finish reading the sources for this address. Nothing was changed anywhere; this is a read-only
        check. {error.message}
      </p>
      <button type="button" onClick={reset} className="rounded-sm border border-ink px-5 py-3 font-mono text-sm uppercase">
        Try again
      </button>
    </div>
  );
}
