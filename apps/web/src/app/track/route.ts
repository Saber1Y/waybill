import { NextResponse, type NextRequest } from "next/server";

/** The home form submits here; redirect to the canonical tracking URL. */
export function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address")?.trim();
  const tx = request.nextUrl.searchParams.get("tx")?.trim();
  if (!address) return NextResponse.redirect(new URL("/", request.url));
  const target = new URL(`/track/${encodeURIComponent(address)}`, request.url);
  if (tx) target.searchParams.set("tx", tx);
  return NextResponse.redirect(target);
}
