const STEPS = ["Asking 1Click", "Reading the explorer", "Reading NEAR settlement", "Checking origin and destination chains"];

export default function Loading() {
  return (
    <div className="sheet rounded-sm px-5 pt-9 pb-7 sm:px-8" role="status" aria-live="polite">
      <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">Tracing</p>
      <ol className="mt-6 space-y-4">
        {STEPS.map((step, i) => (
          <li key={step} className="flex items-center gap-4 text-muted">
            <span
              aria-hidden
              className="size-3 animate-pulse rounded-full bg-rule-strong motion-reduce:animate-none"
              style={{ animationDelay: `${i * 180}ms` }}
            />
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}
