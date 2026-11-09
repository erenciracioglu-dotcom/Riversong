/* Riversong — fills the sprite batches each frame: stones, reeds, falls, gravel, twigs, lanterns, effects. */
'use strict';
RS.scene = (() => {
  const M = RS.model, U = RS.util, MU = RS.music;
  const TAU = Math.PI * 2;
  const inRect = (r, x, y, m = 0) => x > r[0] - m && x < r[2] + m && y > r[1] - m && y < r[3] + m;

  // ---- cached decorations (recomputed when the stream changes) ----
  function grains(V, g) {
    const st = M.stream(V, g.sid);
    if (!st) return [];
    const key = st.id + ':' + st.ver + ':' + g.a + ':' + g.b;
    if (g._key === key) return g._grains;
    const r = U.rng(g.seed || 7);
    const out = [];
    const unit = st.k * M.V0;
    const len = (g.b - g.a) * unit;
    const n = Math.max(6, Math.round(len / 2.6));
    for (let i = 0; i < n; i++) {
      const u = g.a + (g.b - g.a) * (i + r()) / n;
      const p = M.pointAtU(st, u), hw = M.widthAt(st, u) / 2;
      const off = (r() * 2 - 1) * hw * 0.9;
      const tone = 0.62 + r() * 0.33;
      out.push({ x: p.x - p.ty * off, y: p.y + p.tx * off, s: 1.3 + r() * 1.8, rot: r() * TAU, c: [tone * 1.06, tone * 1.0, tone * 0.86], seed: r(), u });
    }
    g._key = key; g._grains = out;
    return out;
  }
  function blades(V, rd) {
    const st = M.stream(V, rd.sid);
    if (!st) return [];
    const key = st.id + ':' + st.ver + ':' + rd.a + ':' + rd.b + ':' + rd.side + ':' + rd.size;
    if (rd._key === key) return rd._blades;
    const r = U.rng(rd.seed || 11);
    const out = [];
    const unit = st.k * M.V0;
    const h = MU.reedHeight(rd.size);
    const len = (rd.b - rd.a) * unit;
    const n = Math.max(3, Math.round(len / 5));
    const tall = rd.size >= 6;
    for (let i = 0; i < n; i++) {
      const u = rd.a + (rd.b - rd.a) * (i + 0.2 + r() * 0.6) / n;
      const p = M.pointAtU(st, u), hw = M.widthAt(st, u) / 2;
      const nx = -p.ty * rd.side, ny = p.tx * rd.side;
      const d = hw + 1.5 + r() * 7;
      const bx = p.x + nx * d, by = p.y + ny * d;
      const k = 2 + Math.floor(r() * 2);
      for (let j = 0; j < k; j++) {
        const ang = Math.atan2(ny, nx) + (r() - 0.5) * 1.5;
        const L = h * (0.6 + r() * 0.5);
        const g = 0.85 + r() * 0.3;
        out.push({ bx, by, ang, L, w: 1.0 + r() * 0.8 + h * 0.02, u, head: tall && r() < 0.35, c: [0.38 * g, 0.55 * g, 0.24 * g], ph: r() * TAU });
      }
    }
    rd._key = key; rd._blades = out;
    return out;
  }
  function ledge(V, f) {
    const st = M.stream(V, f.sid);
    if (!st) return null;
    const key = st.id + ':' + st.ver + ':' + f.u;
    if (f._key === key) return f._ledge;
    const r = U.rng(f.seed || 3);
    const p = M.pointAtU(st, f.u), hw = M.widthAt(st, f.u) / 2;
    const nx = -p.ty, ny = p.tx;
    const rocks = [];
    const n = Math.max(4, Math.round(hw / 3.2));
    for (let i = 0; i < n; i++) {
      const o = (-1.15 + (2.3 * (i + 0.5)) / n + (r() - 0.5) * 0.18) * hw;
      rocks.push({ x: p.x + nx * o - p.tx * (r() * 2.5), y: p.y + ny * o - p.ty * (r() * 2.5), r: 2.6 + r() * 2.6, seed: r() });
    }
    f._key = key;
    f._ledge = { p, hw, rocks, big: M.speedAt(st, Math.max(0, f.u - 0.5)) <= 0.5 };
    return f._ledge;
  }
  // where lanterns gathered behind a dam float
  const CROWD = [[0, 0], [0.62, -0.55], [0.62, 0.55], [1.2, 0], [1.75, -0.6], [1.75, 0.6], [2.3, 0.05], [2.85, -0.5], [2.85, 0.5]];
  function heldSpot(st, twigU, i, tSec) {
    const c = CROWD[i % CROWD.length];
    const unit = st.k * M.V0;
    let u = twigU - (11 + c[0] * 11 + Math.sin(tSec * 1.3 + i * 1.7) * 0.8) / unit;
    if (st.closed) u = ((u % st.U) + st.U) % st.U; else u = Math.max(0, u);
    const p = M.pointAtU(st, u), hw = M.widthAt(st, u) / 2;
    const lat = c[1] * Math.min(hw * 0.9, 11) + Math.sin(tSec * 0.9 + i * 2.3) * 0.7;
    return { x: p.x - p.ty * lat, y: p.y + p.tx * lat, rot: Math.atan2(p.ty, p.tx) + Math.sin(tSec * 0.7 + i) * 0.25 };
  }

  function build(app, B, tSec, dt, sky, opt = {}) {
    const R = RS.render, bt = opt.batches || R.batches, V = app.valley;
    for (const k in bt) bt[k].clear();
    if (!V) return [];
    const rect = opt.rect || R.viewRect(90);
    const night = sky.night;
    const sun = sky.sun, sl = sky.shadowLen, sa = sky.shadowAlpha;
    const lights = [];
    const fx = RS.fx;
    const zoom = opt.zoom || R.cam.zoom;

    // lanterns: positions first (reeds and spokes react to them)
    const lpos = [];
    const heldBy = new Map();
    for (const L of RS.sim.lanterns) {
      if (L.state === 'gone') continue;
      if (L.state === 'held') { if (!heldBy.has(L.heldBy)) heldBy.set(L.heldBy, []); heldBy.get(L.heldBy).push(L); continue; }
      const p = RS.sim.lanternPos(L, B);
      if (!p) continue;
      const q = M.pointAtU(p.st, p.u);
      lpos.push({ L, st: p.st, u: p.u, x: q.x, y: q.y, rot: Math.atan2(q.ty, q.tx), waiting: p.waiting });
    }
    for (const [twigId, list] of heldBy) {
      const tw = V.twigs.find((w) => w.id === twigId);
      list.sort((a, b) => a.heldAt - b.heldAt);
      list.forEach((L, i) => {
        const st = M.stream(V, L.sid);
        if (!st) return;
        const s = heldSpot(st, tw ? tw.u : L.ua, i, tSec);
        lpos.push({ L, st, u: L.ua, x: s.x, y: s.y, rot: s.rot, held: true, crowd: list.length });
      });
    }
    const lanternsOn = new Map();
    for (const lp of lpos) { if (!lanternsOn.has(lp.st.id)) lanternsOn.set(lp.st.id, []); lanternsOn.get(lp.st.id).push(lp); }
    const nearLantern = (st, u, width) => {
      const list = lanternsOn.get(st.id);
      if (!list) return 0;
      let g = 0;
      for (const lp of list) {
        if (lp.held) continue;
        let du = Math.abs(lp.u - u);
        if (st.closed) du = Math.min(du, st.U - du);
        const dw = du * st.k * M.V0;
        g = Math.max(g, Math.exp(-(dw * dw) / (width * width)));
      }
      return g;
    };

    // surges (a released dam flashes down the water)
    for (const st of V.streams) st._glow = 0;
    for (const s of fx.surges) {
      const st = M.stream(V, s.sid);
      if (st) st._glow = Math.max(st._glow, Math.exp(-(tSec - s.t0) * 1.5));
    }

    // gravel beds
    for (const g of V.gravel) {
      const hitAge = fx.since(fx.gravelHit, g.id);
      const jig = Math.exp(-hitAge * 9) * 0.9;
      for (const gr of grains(V, g)) {
        if (!inRect(rect, gr.x, gr.y)) continue;
        const jx = jig ? (Math.sin(gr.seed * 99 + tSec * 60) * jig) : 0;
        bt.under.add(gr.x + jx, gr.y, gr.s, gr.s * 0.82, gr.rot, 5, gr.seed, 0, 0, 0, gr.c[0], gr.c[1], gr.c[2], 0.95);
      }
    }
    // falls
    for (const f of V.falls) {
      const lg = ledge(V, f);
      if (!lg || !inRect(rect, lg.p.x, lg.p.y, 40)) continue;
      const thump = Math.exp(-fx.since(fx.stoneGlow, f.id) * 3);
      const rot = Math.atan2(-lg.p.tx, lg.p.ty);
      bt.over.add(lg.p.x + lg.p.tx * lg.hw * 0.95, lg.p.y + lg.p.ty * lg.hw * 0.95, lg.hw * 1.12, lg.hw * (lg.big ? 1.2 : 0.95), rot, 8, 0, lg.big ? 1.1 : 1.5, 0, 0, 1, 1, 1, 0.62 + thump * 0.3);
      for (const k of lg.rocks) {
        bt.shadow.add(k.x - sun[0] * sl * 1.5, k.y - sun[1] * sl * 1.5, k.r * 1.2, k.r * 1.05, 0, 4, 0, 0, 0, 0, 0.05, 0.06, 0.04, sa);
        bt.obj.add(k.x, k.y, k.r, k.r, k.seed * TAU, 0, k.seed, thump * 0.5, 1, 0, 1, 1, 1, 1);
      }
    }
    // reeds
    let fireflyN = 0;
    for (const rd of V.reeds) {
      const st = M.stream(V, rd.sid);
      if (!st) continue;
      const bl = blades(V, rd);
      const rs = fx.reedState.get(rd.id);
      const playing = rs && rs.on > 0 ? 1 : 0;
      for (const b of bl) {
        if (!inRect(rect, b.bx, b.by, 40)) continue;
        const near = nearLantern(st, b.u, 34);
        const inside = near > 0.02 && (st.closed || (b.u >= rd.a - 0.3 && b.u <= rd.b + 0.3)) ? near : 0;
        const sway = Math.sin(tSec * 1.3 + b.ph + b.bx * 0.02) * 0.08 + inside * 0.35 * Math.sin(tSec * 7 + b.ph);
        const ang = b.ang + sway;
        const cx = b.bx + Math.cos(ang) * b.L * 0.5, cy = b.by + Math.sin(ang) * b.L * 0.5;
        const glow = Math.max(inside * 0.9, playing * 0.12);
        bt.shadow.add(cx - sun[0] * sl * b.L * 0.25, cy - sun[1] * sl * b.L * 0.25, b.L * 0.5, b.w * 1.2, ang, 4, 0, 0, 0, 0, 0.05, 0.07, 0.04, sa * 0.6);
        bt.obj.add(cx, cy, b.L * 0.5, b.head ? b.w * 2.2 : b.w, ang, 1, b.ph, glow, b.head ? 1 : 0, b.head ? 0.45 : 1, b.c[0], b.c[1], b.c[2], 1);
        if (inside > 0.2) bt.glow.add(cx, cy, b.L * 0.6, b.L * 0.6, 0, 9, 2.4, 0, 0, 0, 1.0, 0.8, 0.4, inside * (0.06 + 0.25 * night));
      }
      // fireflies at night
      if (night > 0.35 && fireflyN < 40 && bl.length) {
        const r = U.rng((rd.seed || 1) + 5);
        for (let k = 0; k < 3; k++) {
          const b = bl[Math.floor(r() * bl.length)];
          const ph = r() * 50;
          const fx_ = b.bx + Math.sin(tSec * 0.4 + ph) * 16 + Math.cos(tSec * 0.23 + ph * 2) * 8;
          const fy = b.by + Math.cos(tSec * 0.31 + ph) * 14 + Math.sin(tSec * 0.17 + ph) * 9;
          const blink = Math.pow(Math.max(0, Math.sin(tSec * 1.6 + ph * 3)), 3) * (night - 0.35) / 0.65;
          if (blink > 0.02 && inRect(rect, fx_, fy)) { bt.glow.add(fx_, fy, 5, 5, 0, 10, 0, 0, 0, 0, 0.85, 1.0, 0.5, blink); fireflyN++; }
        }
      }
    }
    // stones
    const R_ = MU.stoneRadius;
    for (const s of V.stones) {
      if (!inRect(rect, s.x, s.y, 20)) continue;
      let x = s.x, y = s.y;
      if (s._anim) {
        const k = U.clamp((tSec - s._anim.t0) / 0.35, 0, 1), e = 1 - Math.pow(1 - k, 3);
        x = U.lerp(s._anim.x, s.x, e); y = U.lerp(s._anim.y, s.y, e);
        if (k >= 1) s._anim = null;
      }
      const grow = s._grow ? 1 + 0.18 * Math.exp(-(tSec - s._grow) * 8) : 1;
      const r = R_(s.size) * grow;
      const age = fx.since(fx.stoneGlow, s.id);
      const glow = Math.exp(-age * 2.4);
      const wet = RS.sim.stoneAttach(s.id) ? 1 : 0;
      const h = r * 0.55;
      bt.shadow.add(x - sun[0] * sl * h, y - sun[1] * sl * h, r * 1.15, r * 1.0, 0, 4, 0, 0, 0, 0, 0.04, 0.05, 0.04, sa * (wet ? 0.7 : 1));
      bt.obj.add(x, y, r, r, s.seed * TAU, 0, s.seed, glow, wet, 0, 1, 1, 1, s._ghost ? 0.55 : 1);
      if (glow > 0.03) {
        bt.glow.add(x, y, r * 3.2, r * 3.2, 0, 9, 2.0, 0, 0, 0, 1.0, 0.88, 0.62, glow * (0.12 + 0.55 * night));
        if (night > 0.3 && glow > 0.2) lights.push({ x, y, r: 26 + r * 3, i: glow * 0.5 * night, c: [1.0, 0.85, 0.6], pri: 1 });
      }
    }
    // ponds: start marks and faint beat spokes; they light up as the lantern sweeps past
    const lines = U.clamp((zoom - 0.32) / 0.45, 0, 1);
    for (const st of V.streams) {
      if (!st.closed) continue;
      const bb = st.bbox;
      if (bb[2] < rect[0] || bb[0] > rect[2] || bb[3] < rect[1] || bb[1] > rect[3]) continue;
      const mp = fx.markPos(st);
      const pulse = Math.exp(-fx.since(fx.ringPulse, st.id) * 2.2);
      bt.shadow.add(mp.x - sun[0] * sl * 1.5, mp.y - sun[1] * sl * 1.5, 7, 6, 0, 4, 0, 0, 0, 0, 0.04, 0.05, 0.04, sa);
      bt.obj.add(mp.x, mp.y, 6.2, 5.4, st.seed, 12, (st.seed % 100) / 100, pulse, 0, 0, 1, 1, 1, 1);
      if (pulse > 0.02) bt.glow.add(mp.x, mp.y, 22, 22, 0, 9, 2.2, 0, 0, 0, 1, 0.9, 0.65, pulse * (0.25 + 0.5 * night));
      if (lines > 0.01) {
        const rad = Math.min(st.bbox[2] - st.bbox[0], st.bbox[3] - st.bbox[1]) * 0.5;
        const Ls = Math.min(rad * 0.55, 46);
        for (let t = 0; t < st.D - 1e-6; t += 1) {
          const u = M.uAtTime(st, t);
          const p = M.pointAtU(st, u), hw = M.widthAt(st, u) / 2;
          const nx = -p.ty * st.inner, ny = p.tx * st.inner;
          const near = nearLantern(st, u, 30);
          const a = (0.1 + near * 0.5) * lines;
          bt.over.add(p.x + nx * (hw * 0.6 + Ls / 2), p.y + ny * (hw * 0.6 + Ls / 2), Ls / 2, 1.1, Math.atan2(ny, nx), 11, 1, 0, 0, 0, 0.95, 0.98, 1, a);
          if (near > 0.1) bt.glow.add(p.x + nx * (hw * 0.6 + Ls / 2), p.y + ny * (hw * 0.6 + Ls / 2), Ls / 2, 2.2, Math.atan2(ny, nx), 11, 1, 0, 0, 0, 1, 0.85, 0.55, near * (0.08 + 0.3 * night));
        }
      }
    }
    // the next way a lantern will take at each fork
    for (const [sid, e] of RS.sim.trig) {
      const st = M.stream(V, sid);
      if (!st) continue;
      for (const d of e.dec) {
        if (d.kind !== 'branch') continue;
        const n = V.toggles[d.key] || 0;
        const opts = [null].concat(d.opts);
        const pick = opts[n % opts.length];
        let p;
        if (pick) { const c = M.stream(V, pick); if (!c) continue; p = M.pointAtU(c, Math.min(0.7, c.U)); }
        else p = M.pointAtU(st, st.closed ? (d.u + 0.7) % st.U : Math.min(st.U, d.u + 0.7));
        if (!inRect(rect, p.x, p.y)) continue;
        const spark = Math.exp(-fx.since(fx.forkSpark, d.key) * 3);
        const pulse = 0.6 + 0.4 * Math.sin(tSec * 3);
        bt.glow.add(p.x, p.y, 10 + spark * 10, 10 + spark * 10, 0, 9, 2, 0, 0, 0, 0.75, 0.9, 1.0, (0.12 + 0.25 * night) * pulse + spark * 0.4);
      }
    }
    // twigs
    for (const w of V.twigs) {
      const st = M.stream(V, w.sid);
      if (!st) continue;
      const p = M.pointAtU(st, w.u), hw = M.widthAt(st, w.u) / 2;
      if (!inRect(rect, p.x, p.y, 40)) continue;
      const rot = Math.atan2(p.tx, -p.ty) + (w.seed - 0.5) * 0.3;
      const lift = w._lift ? U.clamp((tSec - w._lift) / 0.5, 0, 1) : 0;
      bt.shadow.add(p.x - sun[0] * sl * 3, p.y - sun[1] * sl * 3, hw * 1.4, 5, rot, 4, 0, 0, 0, 0, 0.04, 0.04, 0.03, sa);
      bt.obj.add(p.x, p.y, hw * 1.42, 5.2, rot, 2, w.seed, 0, 0, 0, 1, 1, 1, 1 - lift);
    }
    // lanterns (crowds share their glow so a dam release does not blind the night)
    const lr = 7.4;
    for (const lp of lpos) {
      let n = 0;
      for (const o of lpos) if (Math.abs(o.x - lp.x) < 36 && Math.abs(o.y - lp.y) < 36) n++;
      lp.crowd = Math.max(lp.crowd || 1, n);
    }
    const litAt = [];
    for (const lp of lpos) {
      if (!inRect(rect, lp.x, lp.y, 160)) {
        lights.push({ x: lp.x, y: lp.y, r: 130, i: 0.08 + 0.95 * night, c: [1.0, 0.7, 0.36], pri: 2 });
        continue;
      }
      const app = fx.since(fx.lanternAppear, lp.L.id);
      const fade = U.clamp(app / 0.45, 0, 1);
      const bob = Math.sin(tSec * 1.7 + lp.L.born * 3) * 0.08;
      const sc = (lp.L.transient ? 0.86 : 1) * (0.7 + 0.3 * fade);
      const pul = lp.waiting ? 0.75 + 0.25 * Math.sin(tSec * 6) : 1;
      bt.shadow.add(lp.x - sun[0] * sl * 3, lp.y - sun[1] * sl * 3, lr * 1.25 * sc, lr * 1.15 * sc, 0, 4, 0, 0, 0, 0, 0.04, 0.05, 0.04, sa * 0.8 * fade);
      bt.obj.add(lp.x, lp.y, lr * sc, lr * sc, lp.rot + bob, 3, 0, 0.5 + 0.5 * night, 0, 0, 1, 1, 1, fade);
      const share = 1 / Math.sqrt(lp.crowd || 1);
      bt.glow.add(lp.x, lp.y, 34 * sc, 34 * sc, 0, 9, 2.0, 0, 0, 0, 1.0, 0.72, 0.36, (0.14 + 0.5 * night) * fade * pul * share);
      bt.glow.add(lp.x, lp.y, 9 * sc, 9 * sc, 0, 9, 1.5, 0, 0, 0, 1.0, 0.9, 0.7, (0.22 + 0.45 * night) * fade * pul * Math.max(0.5, share));
      const near = litAt.find((q) => Math.abs(q.x - lp.x) < 46 && Math.abs(q.y - lp.y) < 46);
      if (near) near.i = Math.min(near.base * 1.6, near.i + near.base * 0.12);
      else { const base = (0.06 + 0.85 * night) * fade; const L = { x: lp.x, y: lp.y, r: 125, i: base, base, c: [1.0, 0.7, 0.36], pri: 3 }; litAt.push(L); lights.push(L); }
    }
    // ghosts: lanterns drifting off at the end of their water
    for (const g of fx.ghosts) {
      const k = (tSec - g.t0) / 1.6;
      if (k < 0 || k > 1) continue;
      const a = 1 - k;
      const s = g.kind === 'out' ? 1 - k * 0.3 : 1 - k * 0.6;
      bt.obj.add(g.x, g.y, lr * s, lr * s, g.rot, 3, 0, 0.3, 0, 0, 1, 1, 1, a * (g.kind === 'out' ? 0.6 : 0.9));
      if (g.kind !== 'out') bt.glow.add(g.x, g.y, 30 * s, 30 * s, 0, 9, 2, 0, 0, 0, 1, 0.75, 0.4, a * (0.15 + 0.5 * night));
    }
    // ripples (stencilled onto the water) and land splashes
    for (const r of fx.ripples) {
      const k = (tSec - r.t0) / r.dur;
      if (k < 0 || k > 1 || !inRect(rect, r.x, r.y, r.r1)) continue;
      const e = 1 - Math.pow(1 - k, 2.2);
      const rad = r.r0 + (r.r1 - r.r0) * e;
      const a = r.a * (1 - k) * (1 - k);
      const tb = r.land ? bt.under : bt.ripple;
      tb.add(r.x, r.y, rad, rad, 0, 7, r.th, r.x * 0.1, 0, 0, r.col[0], r.col[1], r.col[2], a * (r.land ? 1 : 1 - 0.45 * night));
      if (!r.land && night > 0.25 && a > 0.04) bt.glow.add(r.x, r.y, rad, rad, 0, 7, r.th, r.x * 0.1, 0, 0, 0.55, 0.65, 0.85, a * 0.35 * night);
    }
    // particles
    for (const p of fx.parts) {
      const age = tSec - p.t0;
      if (age < 0 || !inRect(rect, p.x, p.y, 30)) continue;
      const k = age / p.life;
      const s = p.size + p.grow * k;
      const a = p.a * (1 - k);
      (p.layer === 'under' ? bt.under : bt.over).add(p.x, p.y, s, s, 0, 6, 1.6, 0, 0, 0, p.col[0], p.col[1], p.col[2], a);
    }
    // sync threads between ponds that come back into step
    for (const c of fx.arcs) {
      const k = (tSec - c.t0) / 1.8;
      if (k < 0 || k > 1) continue;
      const dx = c.bx - c.ax, dy = c.by - c.ay, L = Math.hypot(dx, dy);
      const a = Math.sin(Math.PI * Math.min(1, k * 3)) * (1 - k);
      bt.glow.add((c.ax + c.bx) / 2, (c.ay + c.by) / 2, L / 2, 2.6, Math.atan2(dy, dx), 11, 0, L / 6, 0, 0, 1, 0.86, 0.55, a * (0.35 + 0.4 * night));
    }
    if (!opt.thumb) {
      // tool previews from the hand, rain clouds and drops
      RS.input.previews(bt, tSec, sky);
      RS.rain.draw(bt, tSec, sky);
    }
    lights.sort((a, b) => b.pri - a.pri);
    return lights;
  }
  return { build, blades, grains, ledge };
})();
