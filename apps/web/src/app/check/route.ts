import { NextResponse, type NextRequest } from "next/server";

/** The home form's "Check before sending" button submits here; redirect to the canonical check URL. */
export function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address")?.trim();
  if (!address) return NextResponse.redirect(new URL("/", request.url));
  return NextResponse.redirect(new URL(`/check/${encodeURIComponent(address)}`, request.url));
}
