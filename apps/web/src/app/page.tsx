import Link from "next/link";

const CASES = [
  {
    label: "near/intents#382",
    note: "ETH sent on the wrong chain. No NEAR Intents source knows the swap.",
    href: "/track/0xDF7A93d400159d0f8f40AAe42576d01285EA9e39?tx=0x4ae0bb73e8efe79bf5a3aedeb0302371ab0d7fe0a918ebd0b1c8054a9807c593",
  },
  {
    label: "near/intents#384",
    note: "The API says SUCCESS. The public trail ends at the confidential treasury.",
    href: "/track/0x0B3e718FF16f00F67AD99f45efEB85eE49B771e5",
  },
  {
    label: "A live refund",
    note: "Refunded with INTENT_SUBMIT_FAILED. The quote signature checks out.",
    href: "/track/07e80e4816380cfc86f285a5819f5dcdb0ab980d4a205512b8f41ae477244670",
  },
];

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="max-w-2xl space-y-4">
        <h1 className="text-3xl leading-tight font-semibold text-balance sm:text-4xl">
          Where is my swap?
        </h1>
        <p className="text-lg leading-relaxed text-muted text-pretty">
          Paste a NEAR Intents deposit address. Before you send, Waybill checks the quote: what to send, on which chain, by
          when. After, it asks 1Click, the explorer and the chains themselves, shows each leg of the swap, and points at the
          exact spot where the sources stop agreeing.
        </p>
      </section>

      <form action="/track" method="get" className="sheet space-y-5 rounded-sm px-5 pt-8 pb-6 sm:px-8">
        <label className="block space-y-2">
          <span className="font-mono text-xs tracking-[0.14em] text-muted uppercase">Deposit address</span>
          <input
            name="address"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="0x… or the address from your quote"
            className="w-full rounded-sm border border-rule-strong bg-paper-2 px-3 py-3 font-mono text-sm placeholder:text-muted/70 focus:border-reported"
          />
        </label>
        <label className="block space-y-2">
          <span className="font-mono text-xs tracking-[0.14em] text-muted uppercase">
            Your deposit transaction <span className="normal-case tracking-normal">(optional, finds wrong-chain deposits)</span>
          </span>
          <input
            name="tx"
            autoComplete="off"
            spellCheck={false}
            placeholder="0x…"
            className="w-full rounded-sm border border-rule-strong bg-paper-2 px-3 py-3 font-mono text-sm placeholder:text-muted/70 focus:border-reported"
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            className="rounded-sm bg-ink px-5 py-3 font-mono text-sm font-medium tracking-[0.1em] text-paper uppercase transition-transform duration-150 ease-out hover:-translate-y-px active:translate-y-0"
          >
            Trace this swap
          </button>
          <button
            type="submit"
            formAction="/check"
            className="rounded-sm border border-ink px-5 py-3 font-mono text-sm font-medium tracking-[0.1em] uppercase transition-colors duration-150 hover:bg-paper-2"
          >
            Check before sending
          </button>
        </div>
      </form>

      <section className="space-y-3">
        <h2 className="font-mono text-xs tracking-[0.14em] text-muted uppercase">Real cases, traced live</h2>
        <ul className="divide-y divide-rule border-y border-rule">
          {CASES.map((c) => (
            <li key={c.label}>
              <Link href={c.href} className="group flex flex-col gap-1 py-4 sm:flex-row sm:items-baseline sm:gap-6">
                <span className="shrink-0 font-mono text-sm font-medium underline decoration-rule-strong underline-offset-4 group-hover:decoration-ink sm:w-44">
                  {c.label}
                </span>
                <span className="text-muted">{c.note}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-mono text-xs tracking-[0.14em] text-muted uppercase">Before you send</h2>
        <p className="max-w-2xl leading-relaxed text-pretty text-muted">
          How often does your route actually complete?{" "}
          <Link href="/routes" className="text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
            See a day of NEAR Intents swaps, route by route
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
