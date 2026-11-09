/* Riversong — the valley: water geometry, beats along the water, objects, editing, saving. */
'use strict';
RS.model = (() => {
  const U = RS.util;
  const V0 = 56;            // world units of water per beat at normal speed
  const STEP = 4;           // centerline spacing
  const WORLD = { w: 2000, h: 1250 };
  const WIDTH = (s) => (s >= 2 ? 13 : s <= 0.5 ? 42 : 22);
  const MIN_LEN = 0.75 * V0;

  // ---------------- streams ----------------
  // A stream is a centerline polyline. Its length is a whole number of beats (U) at normal speed;
  // k stretches the beat spacing slightly so that holds exactly. speed[i] is the speed of beat cell i.
  function makeStream(o) {
    const st = {
      id: o.id || U.uid('s'),
      pts: o.pts,
      closed: !!o.closed,
      startAttach: o.startAttach || null,
      endAttach: o.endAttach || null,
      seed: o.seed != null ? o.seed : Math.floor(Math.random() * 1e6),
    };
    finalize(st, o.U, o.speed);
    return st;
  }
  function finalize(st, Ufixed, speed) {
    st.cum = U.cumLengths(st.pts, st.closed);
    st.len = st.cum[st.cum.length - 1];
    const minU = st.closed ? 2 : 1;
    st.U = Math.max(minU, Ufixed || Math.round(st.len / V0));
    st.k = st.len / (st.U * V0);
    st.speed = speed && speed.length === st.U ? Float32Array.from(speed) : new Float32Array(st.U).fill(1);
    buildTime(st);
    st.ver = (st.ver || 0) + 1;
    // centroid & bbox (ponds use the centroid for their circling current)
    let cx = 0, cy = 0, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const p of st.pts) { cx += p[0]; cy += p[1]; x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    st.cx = cx / st.pts.length; st.cy = cy / st.pts.length;
    st.bbox = [x0, y0, x1, y1];
    if (st.closed) {
      // which side of the water faces the pond (+1: the left normal), and which way it circles
      let inner = 0, turn = 0;
      const n = st.pts.length;
      for (let i = 0; i < n; i += 2) {
        const p = st.pts[i], q2 = st.pts[(i + 1) % n];
        const tx = q2[0] - p[0], ty = q2[1] - p[1];
        inner += -ty * (st.cx - p[0]) + tx * (st.cy - p[1]);
        turn += (p[0] - st.cx) * ty - (p[1] - st.cy) * tx;
      }
      st.inner = inner >= 0 ? 1 : -1;
      st.dir = turn >= 0 ? 1 : -1;
    }
  }
  function buildTime(st) {
    st.T = new Float64Array(st.U + 1);
    for (let i = 0; i < st.U; i++) st.T[i + 1] = st.T[i] + 1 / st.speed[i];
    st.D = st.T[st.U];
  }
  function timeAt(st, u) {
    if (u <= 0) return 0;
    if (u >= st.U) return st.D;
    const i = Math.floor(u);
    return st.T[i] + (u - i) / st.speed[i];
  }
  function uAtTime(st, t) {
    if (t <= 0) return 0;
    if (t >= st.D) return st.U;
    let lo = 0, hi = st.U - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (st.T[m] <= t) lo = m; else hi = m - 1; }
    return lo + (t - st.T[lo]) * st.speed[lo];
  }
  function speedAt(st, u) {
    let i = Math.floor(u);
    if (st.closed) i = ((i % st.U) + st.U) % st.U; else i = U.clamp(i, 0, st.U - 1);
    return st.speed[i];
  }
  // point + unit tangent at arc length s
  function pointAtS(st, s) {
    const n = st.pts.length, cum = st.cum;
    if (st.closed) { s = ((s % st.len) + st.len) % st.len; } else s = U.clamp(s, 0, st.len);
    let lo = 0, hi = cum.length - 1;
    while (lo < hi - 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const a = st.pts[lo % n], b = st.pts[hi % n];
    const seg = cum[hi] - cum[lo];
    const t = seg > 0 ? (s - cum[lo]) / seg : 0;
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const L = Math.hypot(tx, ty) || 1;
    return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, tx: tx / L, ty: ty / L };
  }
  const pointAtU = (st, u) => pointAtS(st, u * st.k * V0);
  // water width at u: by speed, eased across cell borders, a little organic wobble, springs taper in
  function widthAt(st, u) {
    const n = st.U;
    let i = Math.floor(u), f = u - i;
    const cell = (j) => {
      if (st.closed) j = ((j % n) + n) % n; else j = U.clamp(j, 0, n - 1);
      return WIDTH(st.speed[j]);
    };
    let w = cell(i);
    if (f < 0.4) w = U.lerp(cell(i - 1), w, U.smooth(0.5 + f / 0.8));
    else if (f > 0.6) w = U.lerp(w, cell(i + 1), U.smooth((f - 0.6) / 0.8));
    w *= 1 + 0.07 * U.noise1(u * 1.3, st.seed) + 0.03 * U.noise1(u * 4.1, st.seed + 7);
    if (!st.closed) {
      if (!st.startAttach) w *= 0.12 + 0.88 * U.smooth(U.clamp(u / 1.1, 0, 1));
      if (!st.endAttach) w *= 0.22 + 0.78 * U.smooth(U.clamp((n - u) / 0.9, 0, 1));
    }
    return w;
  }
  // nearest point on the centerline
  function nearest(st, x, y) {
    const p = st.pts, n = p.length;
    let best = 1e18, bs = 0, bx = 0, by = 0;
    const m = st.closed ? n : n - 1;
    const bb = st.bbox;
    for (let i = 0; i < m; i++) {
      const a = p[i], b = p[(i + 1) % n];
      const r = U.segNearest(a[0], a[1], b[0], b[1], x, y);
      if (r.d < best) { best = r.d; bs = st.cum[i] + (st.cum[i + 1] - st.cum[i]) * r.t; bx = r.px; by = r.py; }
    }
    return { d: best, u: bs / (st.k * V0), x: bx, y: by };
  }
  function insidePond(st, x, y) {
    if (!st.closed) return false;
    const bb = st.bbox;
    if (x < bb[0] || x > bb[2] || y < bb[1] || y > bb[3]) return false;
    let c = false;
    const p = st.pts;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      if ((p[i][1] > y) !== (p[j][1] > y) && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
    }
    return c;
  }
  const snapHalf = (st, u) => {
    let v = Math.round(u * 2) / 2;
    if (st.closed) { v = ((v % st.U) + st.U) % st.U; } else v = U.clamp(v, 0, st.U);
    return v;
  };

  // ---------------- valley ----------------
  function newValley(o = {}) {
    const r = U.rng((Date.now() ^ (Math.random() * 1e9)) >>> 0);
    return {
      v: 1,
      id: o.id || U.uid('v'),
      name: o.name || RS.i18n.randomName(r),
      created: Date.now(),
      updated: Date.now(),
      seed: o.seed != null ? o.seed : Math.floor(r() * 1e6),
      bpm: o.bpm || 84,
      tod: o.tod != null ? o.tod : 0.3,
      streams: [], stones: [], reeds: [], falls: [], gravel: [], twigs: [],
      lanterns: [], toggles: {},
    };
  }
  function index(v) {
    v._map = new Map();
    for (const s of v.streams) v._map.set(s.id, s);
    return v._map;
  }
  const stream = (v, id) => (v._map || index(v)).get(id);

  // water hit test: centerline band (with extra tolerance) or inside a pond
  function hitWater(v, x, y, extra = 0, exclude = null) {
    let best = null;
    for (const st of v.streams) {
      if (st === exclude) continue;
      const bb = st.bbox, pad = 40 + extra;
      if (x < bb[0] - pad || x > bb[2] + pad || y < bb[1] - pad || y > bb[3] + pad) continue;
      const nr = nearest(st, x, y);
      const half = widthAt(st, nr.u) / 2;
      const inPond = insidePond(st, x, y);
      const gap = inPond ? -1 : nr.d - half;
      if (gap <= extra && (!best || gap < best.gap)) best = { st, u: nr.u, d: nr.d, gap, half, px: nr.x, py: nr.y, inPond };
    }
    return best;
  }

  // ---------------- editing ----------------
  // slice centerline between arc lengths s0..s1 (for closed streams s1 may exceed len: wraps)
  function slicePts(st, s0, s1) {
    const out = [];
    const step = STEP;
    const n = Math.max(2, Math.round((s1 - s0) / step) + 1);
    for (let i = 0; i < n; i++) {
      const p = pointAtS(st, s0 + ((s1 - s0) * i) / (n - 1));
      out.push([p.x, p.y]);
    }
    return out;
  }
  // Keep the given integer cell ranges of a stream as new open streams.
  // Returns a remap function (u on old stream) -> {sid, u} | null
  function splitStream(v, st, keep) {
    const pieces = [];
    const unit = st.k * V0;
    for (const [a, b] of keep) {
      if (b - a < 1) continue;
      const speed = [];
      for (let i = a; i < b; i++) speed.push(st.speed[((i % st.U) + st.U) % st.U]);
      const piece = makeStream({
        pts: slicePts(st, a * unit, b * unit),
        closed: false,
        U: b - a,
        speed,
        startAttach: !st.closed && a === 0 ? st.startAttach : null,
        endAttach: !st.closed && b === st.U ? st.endAttach : null,
        seed: st.seed + pieces.length * 31,
      });
      pieces.push({ st: piece, a, b });
    }
    const remap = (u) => {
      for (const p of pieces) {
        let uu = u;
        if (st.closed && uu < p.a) uu += st.U;
        if (uu >= p.a - 1e-6 && uu <= p.b + 1e-6) return { sid: p.st.id, u: U.clamp(uu - p.a, 0, p.b - p.a) };
      }
      return null;
    };
    // replace stream
    const idx = v.streams.indexOf(st);
    v.streams.splice(idx, 1, ...pieces.map((p) => p.st));
    index(v);
    // everything that referenced the old stream follows the remap
    const fix = (sid, u) => (sid === st.id ? remap(u) : { sid, u });
    for (const o of v.streams) {
      if (o.startAttach && o.startAttach.sid === st.id) { const r = remap(o.startAttach.u); o.startAttach = r ? { sid: r.sid, u: r.u } : null; }
      if (o.endAttach && o.endAttach.sid === st.id) { const r = remap(o.endAttach.u); o.endAttach = r && r.u < stream(v, r.sid).U ? { sid: r.sid, u: r.u } : null; }
    }
    v.reeds = v.reeds.filter((r) => {
      if (r.sid !== st.id) return true;
      const ra = remap(r.a), rb = remap(r.b);
      if (ra && rb && ra.sid === rb.sid && rb.u - ra.u >= 0.5) { r.sid = ra.sid; r.a = ra.u; r.b = rb.u; return true; }
      // partially erased: keep the longest surviving part
      for (const p of pieces) {
        const a = Math.max(r.a, p.a), b = Math.min(r.b, p.b);
        if (b - a >= 1) { r.sid = p.st.id; r.a = a - p.a; r.b = b - p.a; return true; }
      }
      return false;
    });
    for (const key of ['falls', 'twigs']) {
      v[key] = v[key].filter((o) => { const r = fix(o.sid, o.u); if (!r) return false; o.sid = r.sid; o.u = r.u; return true; });
    }
    v.gravel = v.gravel.filter((g) => {
      if (g.sid !== st.id) return true;
      for (const p of pieces) {
        const a = Math.max(g.a, p.a), b = Math.min(g.b, p.b);
        if (b - a >= 0.5) { g.sid = p.st.id; g.a = a - p.a; g.b = b - p.a; return true; }
      }
      return false;
    });
    const tg = {};
    for (const k in v.toggles) {
      const [sid, u] = k.split('@');
      if (sid !== st.id) { tg[k] = v.toggles[k]; continue; }
      const r = remap(+u);
      if (r) tg[r.sid + '@' + r.u] = v.toggles[k];
    }
    v.toggles = tg;
    return { pieces: pieces.map((p) => p.st), remap };
  }
  // erase beat cells [a, b) of a stream
  function eraseCells(v, st, a, b) {
    a = Math.max(0, Math.floor(a)); b = Math.min(st.U, Math.ceil(b));
    if (b <= a) return null;
    let keep;
    if (st.closed) {
      if (b - a >= st.U) keep = [];
      else keep = [[b, a + st.U]];
    } else keep = [[0, a], [b, st.U]];
    return splitStream(v, st, keep);
  }
  function removeStream(v, st) { return splitStream(v, st, []); }
  function setSpeed(st, a, b, s) {
    for (let i = a; i < b; i++) {
      const j = st.closed ? ((i % st.U) + st.U) % st.U : i;
      if (j >= 0 && j < st.U) st.speed[j] = s;
    }
    buildTime(st);
    st.ver++;
  }
  // the spring that feeds a place on the water: walk up branch attachments
  function rootOf(v, sid) {
    let st = stream(v, sid), guard = 0;
    while (st && st.startAttach && guard++ < 64) {
      const p = stream(v, st.startAttach.sid);
      if (!p) break;
      st = p;
    }
    return st;
  }

  // ---------------- saving ----------------
  const q = (x) => Math.round(x * 2);
  function encodePts(pts) {
    const out = [];
    let px = 0, py = 0;
    for (const p of pts) { const x = q(p[0]), y = q(p[1]); out.push(x - px, y - py); px = x; py = y; }
    return out;
  }
  function decodePts(arr) {
    const out = [];
    let x = 0, y = 0;
    for (let i = 0; i + 1 < arr.length; i += 2) { x += arr[i]; y += arr[i + 1]; out.push([x / 2, y / 2]); }
    return out;
  }
  const r2 = (x) => Math.round(x * 100) / 100;
  function serialize(v) {
    const sidIdx = new Map(v.streams.map((s, i) => [s.id, i]));
    const att = (a) => (a && sidIdx.has(a.sid) ? [sidIdx.get(a.sid), r2(a.u)] : null);
    const spd = (st) => {
      let allOne = true;
      const codes = [];
      for (let i = 0; i < st.U; i++) { const c = st.speed[i] >= 2 ? 2 : st.speed[i] <= 0.5 ? 0 : 1; codes.push(c); if (c !== 1) allOne = false; }
      return allOne ? 0 : codes.join('');
    };
    return {
      v: 1, id: v.id, name: v.name, created: v.created, updated: v.updated, seed: v.seed, bpm: v.bpm, tod: r2(v.tod),
      s: v.streams.map((st) => [encodePts(st.pts), st.closed ? 1 : 0, st.U, att(st.startAttach), att(st.endAttach), spd(st), st.seed]),
      stones: v.stones.map((o) => [r2(o.x), r2(o.y), o.size, o.seed]),
      reeds: v.reeds.filter((o) => sidIdx.has(o.sid)).map((o) => [sidIdx.get(o.sid), r2(o.a), r2(o.b), o.side, o.size, o.seed]),
      falls: v.falls.filter((o) => sidIdx.has(o.sid)).map((o) => [sidIdx.get(o.sid), r2(o.u), o.seed]),
      gravel: v.gravel.filter((o) => sidIdx.has(o.sid)).map((o) => [sidIdx.get(o.sid), r2(o.a), r2(o.b), o.seed]),
      twigs: v.twigs.filter((o) => sidIdx.has(o.sid)).map((o) => [sidIdx.get(o.sid), r2(o.u), o.seed]),
      lanterns: (v.lanterns || []).filter((o) => sidIdx.has(o.sid)).map((o) => [sidIdx.get(o.sid), r2(o.u), o.held ? 1 : 0]),
      toggles: Object.entries(v.toggles || {}).map(([k, n]) => { const [sid, u] = k.split('@'); return sidIdx.has(sid) ? [sidIdx.get(sid), +u, n] : null; }).filter(Boolean),
    };
  }
  function deserialize(o) {
    const v = newValley({ id: o.id, name: o.name, seed: o.seed, bpm: o.bpm, tod: o.tod });
    v.created = o.created || Date.now();
    v.updated = o.updated || Date.now();
    const ids = [];
    for (const s of o.s || []) {
      const [pts, closed, Ucells, sa, ea, spd, seed] = s;
      const speed = spd ? String(spd).split('').map((c) => (c === '2' ? 2 : c === '0' ? 0.5 : 1)) : null;
      const st = makeStream({ pts: decodePts(pts), closed: !!closed, U: Ucells, speed, seed });
      st._sa = sa; st._ea = ea;
      ids.push(st.id);
      v.streams.push(st);
    }
    for (const st of v.streams) {
      st.startAttach = st._sa ? { sid: ids[st._sa[0]], u: st._sa[1] } : null;
      st.endAttach = st._ea ? { sid: ids[st._ea[0]], u: st._ea[1] } : null;
      delete st._sa; delete st._ea;
    }
    index(v);
    v.stones = (o.stones || []).map((a) => ({ id: U.uid('t'), x: a[0], y: a[1], size: a[2], seed: a[3] }));
    v.reeds = (o.reeds || []).map((a) => ({ id: U.uid('r'), sid: ids[a[0]], a: a[1], b: a[2], side: a[3], size: a[4], seed: a[5] }));
    v.falls = (o.falls || []).map((a) => ({ id: U.uid('f'), sid: ids[a[0]], u: a[1], seed: a[2] }));
    v.gravel = (o.gravel || []).map((a) => ({ id: U.uid('g'), sid: ids[a[0]], a: a[1], b: a[2], seed: a[3] }));
    v.twigs = (o.twigs || []).map((a) => ({ id: U.uid('w'), sid: ids[a[0]], u: a[1], seed: a[2] }));
    v.lanterns = (o.lanterns || []).map((a) => ({ sid: ids[a[0]], u: a[1], held: !!a[2] }));
    v.toggles = {};
    for (const t of o.toggles || []) if (ids[t[0]]) v.toggles[ids[t[0]] + '@' + t[1]] = t[2];
    // drop anything pointing at missing streams
    for (const key of ['reeds', 'falls', 'gravel', 'twigs', 'lanterns']) v[key] = v[key].filter((x) => stream(v, x.sid));
    return v;
  }

  return {
    V0, STEP, WORLD, WIDTH, MIN_LEN,
    makeStream, finalize, buildTime, timeAt, uAtTime, speedAt, pointAtS, pointAtU, widthAt, nearest, insidePond, snapHalf,
    newValley, index, stream, hitWater, splitStream, eraseCells, removeStream, setSpeed, rootOf, serialize, deserialize,
  };
})();
