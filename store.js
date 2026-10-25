// Shared-data layer: signed app-data events (kind 30078) on free public Nostr relays. No account, no key, no server.
import { generateSecretKey, getPublicKey, finalizeEvent, SimplePool, bytesToHex, hexToBytes } from './nostr.bundle.js';
export { generateSecretKey, getPublicKey, bytesToHex, hexToBytes };
export const RELAYS = ['wss://nos.lol', 'wss://relay.primal.net', 'wss://nostr.mom', 'wss://offchain.pub', 'wss://relay.nostr.net'];
export const Q = new URLSearchParams(location.search);
export const TEST = Q.get('ns') === 'test';
const KIND = 30078;
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const now = () => Math.floor(Date.now() / 1000);
export async function sha(s) { const h = await crypto.subtle.digest('SHA-256', typeof s === 'string' ? new TextEncoder().encode(s) : s); return new Uint8Array(h); }
export const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
export async function shaHex(s) { return hex(await sha(s)); }
export function rid(n, alpha) { const a = alpha || 'abcdefghjkmnpqrstuvwxyz23456789'; const b = crypto.getRandomValues(new Uint8Array(n)); return [...b].map(x => a[x % a.length]).join(''); }
const b64 = u => { let s = ''; const c = 0x8000; for (let i = 0; i < u.length; i += c) s += String.fromCharCode.apply(null, u.subarray(i, i + c)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
/* AES-GCM with a 32-byte raw key */
export async function enc(keyBytes, obj) {
  const k = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(JSON.stringify(obj))));
  return { iv: b64(iv), ct: b64(ct) };
}
export async function dec(keyBytes, box) {
  const k = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, k, unb64(box.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
export function createStore(app) {
  const NS = TEST ? app + 'test' : app;
  const T = s => NS + '-' + s;
  const pool = new SimplePool();
  function parse(e) { try { e.data = JSON.parse(e.content); } catch (x) { e.data = {}; } const d = (e.tags.find(t => t[0] === 'd') || [])[1] || ''; e.d = d.startsWith(NS + ':') ? d.slice(NS.length + 1) : d; return e; }
  function dedupe(evs) {
    const byId = new Map(); evs.forEach(e => byId.set(e.id, e));
    const latest = new Map();
    for (const e of byId.values()) { const k = e.pubkey + '|' + e.d; const o = latest.get(k); if (!o || e.created_at > o.created_at) latest.set(k, e); }
    return [...latest.values()];
  }
  async function put(sk, d, tags, content) {
    const ev = finalizeEvent({ kind: KIND, created_at: now(), tags: [['d', NS + ':' + d], ['t', NS], ...tags.map(t => ['t', t])], content: JSON.stringify(content) }, sk);
    const rs = await Promise.allSettled(pool.publish(RELAYS, ev).map(p => Promise.race([p, sleep(9000).then(() => { throw new Error('timeout'); })])));
    if (!rs.some(r => r.status === 'fulfilled')) throw new Error('Could not reach the network. Check your internet and try again.');
    return parse(ev);
  }
  async function query(tags, limit, opt) {
    const f = { kinds: [KIND], '#t': tags, limit: limit || 500 };
    if (opt && opt.since) f.since = opt.since;
    if (opt && opt.authors) f.authors = opt.authors;
    const evs = await pool.querySync(RELAYS, f, { maxWait: (opt && opt.wait) || 4500 });
    return dedupe(evs.map(parse).filter(e => e.tags.some(t => t[0] === 't' && t[1] === NS)));
  }
  function deviceKey() {
    const k = NS + '-sk'; let h = localStorage.getItem(k);
    if (!/^[0-9a-f]{64}$/.test(h || '')) { h = bytesToHex(generateSecretKey()); localStorage.setItem(k, h); }
    return hexToBytes(h);
  }
  return { NS, T, put, query, pool, deviceKey };
}
