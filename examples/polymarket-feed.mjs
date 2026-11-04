// Node.js 22+. Read-only example; no dependencies and no order submission.
import { createHash, createHmac } from 'node:crypto';

const mode = process.env.BRAVADO_FEED_MODE ?? 'onchain';
if (!['onchain', 'fills'].includes(mode)) throw new Error('BRAVADO_FEED_MODE must be onchain or fills');
const key = process.env.BRAVADO_API_KEY;
const secret = process.env.BRAVADO_API_SECRET;
if (!key || !secret) throw new Error('Set your WebSockets key (ws_stream, stream.read) and secret in the environment');
const api = new URL(process.env.BRAVADO_API_ORIGIN ?? 'https://partner-api.bravadotrade.com');
const edge = new URL(process.env.BRAVADO_FEED_ORIGIN ?? 'wss://stream.bravadotrade.com');
for (const [url, secure, local] of [[api, 'https:', 'http:'], [edge, 'wss:', 'ws:']]) {
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== secure && !(url.protocol === local && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('Use a secure origin without credentials, paths or query parameters');
  }
}
const selected = (process.env.BRAVADO_EVENT_FAMILIES ?? 'collateral,resolutions,conditions,token_registrations').split(',');
const known = ['collateral', 'resolutions', 'conditions', 'token_registrations'];
if (!selected.length || selected.some(f => !known.includes(f))) throw new Error('Invalid event families');
const duration = Number(process.env.BRAVADO_SAMPLE_MS ?? 60_000);
if (!Number.isSafeInteger(duration) || duration < 100 || duration > 120_000) throw new Error('Sample duration must be 100–120000 ms');
const path = '/mempool/token' + (mode === 'onchain' ? '?families=' + encodeURIComponent(selected.join(',')) : '');
const timestamp = String(Date.now());
const payload = [timestamp, 'GET', path, createHash('sha256').update('').digest('hex')].join('\n');
const response = await fetch(new URL(path, api), {
  redirect: 'error', signal: AbortSignal.timeout(10_000), headers: {
    'X-Bravado-API-Key': key,
    'X-Bravado-Timestamp': timestamp,
    'X-Bravado-Signature': createHmac('sha256', secret).update(payload).digest('hex'),
  },
});
if (!response.ok) throw new Error(`Grant refused (HTTP ${response.status}); check scope, plan, family grants and credits`);
const grant = await response.json();
if (typeof grant.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(grant.token) ||
    !Number.isSafeInteger(grant.expires_at) || grant.expires_at <= Date.now() / 1000 || grant.expires_at > Date.now() / 1000 + 301 ||
    (mode === 'onchain' && (!Array.isArray(grant.families) || selected.some(f => !grant.families.includes(f))))) {
  throw new Error('Invalid or expired access grant');
}
edge.pathname = mode === 'onchain' ? '/ws/onchain' : '/ws/console';
edge.searchParams.set('token', grant.token);
edge.searchParams.set('mode', 'full');
edge.searchParams.set('streams', mode === 'fills' ? 'fills:polymarket:*' : selected.map(f => `${f === 'token_registrations' ? 'registrations' : f}:polymarket:*`).join(','));
// The URL contains a short-lived token. Never log it or persist it.
const socket = new WebSocket(edge);
const timer = setTimeout(() => socket.close(1000, 'sample complete'), duration);
socket.addEventListener('message', ({ data }) => {
  try { console.log(JSON.stringify(JSON.parse(String(data)))); }
  catch { console.error('Received an unreadable frame'); process.exitCode = 1; }
});
socket.addEventListener('error', () => { console.error('Feed connection failed; verify that this destination has been released'); process.exitCode = 1; clearTimeout(timer); });
socket.addEventListener('close', ({ code }) => {
  clearTimeout(timer);
  if (code !== 1000) { console.error(`Feed closed (${code}); obtain a fresh grant before reconnecting`); process.exitCode = 1; }
});
