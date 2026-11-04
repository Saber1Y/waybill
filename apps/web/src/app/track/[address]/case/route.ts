import { buildCase } from "@waybill/core";
import type { NextRequest } from "next/server";
import { traceSwap } from "@/lib/trace";

export const dynamic = "force-dynamic";

/** The case file as Markdown, re-traced live so the download matches the moment it was taken. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const address = decodeURIComponent((await params).address);
  const tx = request.nextUrl.searchParams.get("tx") ?? undefined;
  const { markdown, caseHash } = buildCase(await traceSwap(address, tx));
  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="waybill-${caseHash.slice(0, 12)}.md"`,
    },
  });
}
