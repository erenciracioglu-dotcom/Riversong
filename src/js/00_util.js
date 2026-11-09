/* Riversong — small shared helpers: math, random, noise, polylines. */
'use strict';
window.RS = window.RS || {};

RS.util = (() => {
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);
  const fract = (x) => x - Math.floor(x);
  const TAU = Math.PI * 2;

  // Deterministic PRNG (mulberry32)
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash2(x, y) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  // 1D value noise (smooth), used for wobbly shapes
  function noise1(x, seed = 0) {
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    return lerp(hash2(i, seed), hash2(i + 1, seed), u) * 2 - 1;
  }
  let _id = 0;
  const uid = (p = '') => p + Date.now().toString(36).slice(-5) + (++_id).toString(36) + Math.floor(Math.random() * 1296).toString(36);

  // ---- polylines: arrays of [x, y] ----
  function polyLength(pts, closed) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (closed && pts.length > 1) L += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
    return L;
  }
  // Even spacing by arc length. For closed polylines the result does not repeat the first point.
  function resample(pts, step, closed) {
    if (pts.length < 2) return pts.map((p) => [p[0], p[1]]);
    const src = closed ? pts.concat([pts[0]]) : pts;
    const cum = [0];
    for (let i = 1; i < src.length; i++) cum.push(cum[i - 1] + Math.hypot(src[i][0] - src[i - 1][0], src[i][1] - src[i - 1][1]));
    const L = cum[cum.length - 1];
    if (L <= 0) return [[src[0][0], src[0][1]]];
    const n = closed ? Math.max(6, Math.round(L / step)) : Math.max(2, Math.round(L / step) + 1);
    const out = [];
    let j = 1;
    for (let k = 0; k < n; k++) {
      const s = closed ? (k * L) / n : (k * L) / (n - 1);
      while (j < src.length - 1 && cum[j] < s) j++;
      const a = src[j - 1], b = src[j];
      const seg = cum[j] - cum[j - 1];
      const t = seg > 0 ? clamp((s - cum[j - 1]) / seg, 0, 1) : 0;
      out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)]);
    }
    return out;
  }
  // Chaikin corner cutting; keeps endpoints for open curves
  function chaikin(pts, iters, closed) {
    let p = pts;
    for (let k = 0; k < iters; k++) {
      if (p.length < 3) return p;
      const q = [];
      const n = p.length;
      if (!closed) q.push(p[0]);
      const m = closed ? n : n - 1;
      for (let i = 0; i < m; i++) {
        const a = p[i], b = p[(i + 1) % n];
        q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
        q.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      if (!closed) q.push(p[n - 1]);
      p = q;
    }
    return p;
  }
  // cumulative arc length table
  function cumLengths(pts, closed) {
    const c = new Float64Array(pts.length + (closed ? 1 : 0));
    for (let i = 1; i < pts.length; i++) c[i] = c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (closed) {
      const n = pts.length;
      c[n] = c[n - 1] + Math.hypot(pts[0][0] - pts[n - 1][0], pts[0][1] - pts[n - 1][1]);
    }
    return c;
  }
  // nearest point on segment
  function segNearest(ax, ay, bx, by, x, y) {
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t, py = ay + dy * t;
    return { t, px, py, d: Math.hypot(x - px, y - py) };
  }
  function shuffle(a, r = Math.random) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  // base64url helpers for share links
  function bytesToB64url(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlToBytes(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function b64ToArrayBuffer(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  return { clamp, lerp, smooth, fract, TAU, rng, hash2, noise1, uid, polyLength, resample, chaikin, cumLengths, segNearest, shuffle, bytesToB64url, b64urlToBytes, b64ToArrayBuffer };
})();
