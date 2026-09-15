import { createHash, createHmac } from 'node:crypto';

const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
export function signHeaders(url, method, body, key, secret, timestamp = String(Date.now())) {
  const u = new URL(url);
  if (u.origin !== 'https://partner-api.bravadotrade.com') throw new Error('Use the HTTPS Partner API origin');
  const entries = [...u.searchParams];
  if (new Set(entries.map(([k]) => k)).size !== entries.length) throw new Error('Use each query parameter once');
  let path = decodeURIComponent(u.pathname);
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  if (entries.length) path += '?' + entries.map(([k, v]) => `${encode(k)}=${encode(v)}`).join('&');
  const hash = createHash('sha256').update(body).digest('hex');
  const payload = [timestamp, method.toUpperCase(), path, hash].join('\n');
  return { 'X-BRAVADO-API-KEY': key, 'X-BRAVADO-TIMESTAMP': timestamp,
    'X-BRAVADO-SIGNATURE': createHmac('sha256', secret).update(payload).digest('hex') };
}
export async function bravadoFetch(url, options = {}) {
  const body = options.body ?? '';
  if (typeof body !== 'string') throw new Error('Serialize the body once before signing');
  const headers = new Headers(options.headers);
  headers.delete('Authorization');
  const signed = signHeaders(url, options.method ?? 'GET', body, process.env.BRAVADO_API_KEY, process.env.BRAVADO_API_SECRET);
  for (const [name, value] of Object.entries(signed)) headers.set(name, value);
  return fetch(url, { ...options, headers, redirect: 'error' });
}
