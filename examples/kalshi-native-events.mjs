import { pathToFileURL } from "node:url";
import { signHeaders } from "./bravado-auth.mjs";

const origin = "https://partner-api.bravadotrade.com";
export function nativePath(channel) {
  if (!["trades", "lifecycle"].includes(channel))
    throw new Error("Choose trades or lifecycle");
  return `/stream/kalshi/partner/${channel}`;
}
export function nativeHeaders(channel, key, secret, timestamp) {
  return signHeaders(`${origin}${nativePath(channel)}`, "GET", "", key, secret, timestamp);
}
export function rawNativeText(raw, binary = false) {
  if (binary) throw new Error("Expected a text frame");
  return raw.toString("utf8"); // Preserve original numeric lexemes; do not JSON.parse native data.
}

async function main() {
  if (process.argv.includes("--check")) {
    const { strict: assert } = await import("node:assert");
    assert.equal(nativePath("trades"), "/stream/kalshi/partner/trades");
    assert.equal(nativePath("lifecycle"), "/stream/kalshi/partner/lifecycle");
    assert.throws(() => nativePath("trades?cursor=old"));
    assert.throws(() => nativePath("book"));
    const native = Buffer.from('{"count_fp":"9007199254740993.125","native_number":90071992547409931234,"native_decimal":0.123456789012345678901}');
    assert.equal(rawNativeText(native), native.toString("utf8"));
    assert.throws(() => rawNativeText(native, true));
    const a = nativeHeaders("trades", "fixture-key", "fixture-secret", "1");
    const b = nativeHeaders("lifecycle", "fixture-key", "fixture-secret", "1");
    assert.notEqual(a["X-BRAVADO-SIGNATURE"], b["X-BRAVADO-SIGNATURE"]);
    assert.equal(a["X-BRAVADO-API-KEY"], "fixture-key");
    assert.equal(a["X-BRAVADO-TIMESTAMP"], "1");
    console.log("Kalshi native example checks passed; no network requests");
    return;
  }
  const channel = process.argv[2] ?? "trades";
  const path = nativePath(channel);
  const key = process.env.BRAVADO_API_KEY;
  const secret = process.env.BRAVADO_API_SECRET;
  if (!key || !secret) throw new Error("Set your Market Data WebSocket key and secret");
  const capabilitiesPath = "/stream/capabilities";
  const response = await fetch(`${origin}${capabilitiesPath}`, {
    headers: signHeaders(`${origin}${capabilitiesPath}`, "GET", "", key, secret),
    redirect: "error", signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Capabilities refused (${response.status})`);
  const capabilities = await response.json();
  const kalshi = capabilities.venues?.find(row => row.venue === "kalshi");
  const advertised = channel === "trades" ? kalshi?.trades_path : kalshi?.lifecycle_path;
  if (!kalshi?.implemented || !kalshi.upstream_registered || !kalshi.entitled || advertised !== path)
    throw new Error("This native channel is not available for your organisation right now");
  const { default: WebSocket } = await import("ws");
  const socket = new WebSocket(`wss://partner-api.bravadotrade.com${path}`, {
    headers: nativeHeaders(channel, key, secret),
    handshakeTimeout: 8_000, followRedirects: false, rejectUnauthorized: true,
    perMessageDeflate: false, maxPayload: 8 * 1024 * 1024,
  });
  socket.on("message", (raw, binary) => {
    if (binary) { socket.close(1003, "Text frames required"); return; }
    console.log(rawNativeText(raw));
  });
  socket.on("error", () => console.error("WebSocket connection failed"));
  const stop = setTimeout(() => socket.close(), 30_000);
  socket.once("close", () => clearTimeout(stop));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error("Kalshi native example refused or disconnected; check access and channel health"); process.exitCode = 1; });
}
