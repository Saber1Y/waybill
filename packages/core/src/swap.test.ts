import { describe, expect, it } from "vitest";
import { extractInitialItem } from "./sources/explorer";
import { assetChain } from "./swap";

describe("assetChain", () => {
  it("prefers the token list", () => {
    expect(assetChain("nep141:x.near", new Map([["nep141:x.near", { blockchain: "base" }]]))).toBe("base");
  });

  it("falls back to the omft prefix", () => {
    expect(assetChain("nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near")).toBe("eth");
    expect(assetChain("nep141:hood.omft.near")).toBe("hood");
    expect(assetChain("nep141:wrap.near")).toBe("near");
  });
});

describe("extractInitialItem", () => {
  it("reads the escaped record out of an RSC payload, including escaped quotes inside strings", () => {
    const html = String.raw`self.__next_f.push([1,"{\"initialItem\":{\"status\":\"SUCCESS\",\"note\":\"a \\\"quoted\\\" } brace\",\"n\":1}}"])`;
    expect(extractInitialItem(html)).toEqual({ status: "SUCCESS", note: 'a "quoted" } brace', n: 1 });
  });

  it("returns undefined when the page has no record", () => {
    expect(extractInitialItem("<html></html>")).toBeUndefined();
  });
});
