/* Riversong — visible causes and echoes: ripples, spray, glows, ghosts, sync threads. */
'use strict';
RS.fx = (() => {
  const M = RS.model, U = RS.util;
  const pending = [];
  const ripples = [];      // {x,y,t0,dur,r0,r1,a,col,th,land}
  const parts = [];        // {x,y,vx,vy,t0,life,size,col,a,grow,drag,layer}
  const ghosts = [];       // {x,y,t0,kind,rot}
  const arcs = [];         // {ax,ay,bx,by,t0}
  const stoneGlow = new Map();
  const gravelHit = new Map();
  const reedState = new Map(); // reed id -> {on: count, t0, tOff}
  const ringPulse = new Map();
  const forkSpark = new Map();
  const lanternAppear = new Map();
  const surges = [];       // {sid, t0}
  const starts = new Map();// beat -> Set of sids (for sync detection)
  let now = 0;
  const secPerBeat = () => 60 / RS.clock.bpm;

  function push(ev) { pending.push(ev); }
  function ripple(x, y, o = {}) {
    ripples.push({ x, y, t0: o.t0 != null ? o.t0 : now, dur: o.dur || 1.6, r0: o.r0 || 3, r1: o.r1 || 30, a: o.a == null ? 0.5 : o.a, col: o.col || [0.92, 0.96, 1.0], th: o.th || 0.12, land: !!o.land });
  }
  function particle(o) { parts.push(Object.assign({ t0: now, life: 1, size: 2, col: [1, 1, 1], a: 0.8, grow: 0, drag: 2, vx: 0, vy: 0, layer: 'over' }, o)); }
  function spray(x, y, nx, ny, tx, ty, hw, big) {
    const n = big ? 26 : 16;
    for (let i = 0; i < n; i++) {
      const across = (Math.random() * 2 - 1) * hw;
      const sp = (big ? 46 : 32) * (0.4 + Math.random());
      const ang = (Math.random() - 0.5) * 1.6;
      const dx = tx * Math.cos(ang) - nx * Math.sin(ang), dy = ty * Math.cos(ang) - ny * Math.sin(ang);
      particle({ x: x + nx * across, y: y + ny * across, vx: dx * sp, vy: dy * sp, life: 0.5 + Math.random() * 0.6, size: 1.2 + Math.random() * 2.2, col: [0.97, 0.99, 1.0], a: 0.85, drag: 2.6, grow: 2 });
    }
    for (let i = 0; i < (big ? 6 : 3); i++) particle({ x: x + tx * hw * 0.8 + nx * (Math.random() - 0.5) * hw * 2, y: y + ty * hw * 0.8 + ny * (Math.random() - 0.5) * hw * 2, life: 1.4, size: hw * 0.6, col: [1, 1, 1], a: 0.22, grow: 10, drag: 1, layer: 'over' });
  }
  function handle(ev, V) {
    const t = now;
    const st = ev.sid ? M.stream(V, ev.sid) : null;
    switch (ev.type) {
      case 'stone': {
        const s = ev.stone;
        if (V.stones.indexOf(s) < 0) return;
        stoneGlow.set(s.id, t);
        const r = RS.music.stoneRadius(s.size);
        const e = 0.75 * secPerBeat();
        const big = 16 + r * 2.4;
        ripple(s.x, s.y, { r0: r * 0.9, r1: big, a: 0.55, dur: 1.5, th: 0.13 });
        ripple(s.x, s.y, { t0: t + e, r0: r * 0.9, r1: big * 1.15, a: 0.3, dur: 1.5, th: 0.11 });
        ripple(s.x, s.y, { t0: t + 2 * e, r0: r * 0.9, r1: big * 1.3, a: 0.16, dur: 1.5, th: 0.1 });
        break;
      }
      case 'fall': {
        if (!st) return;
        const p = M.pointAtU(st, ev.u), hw = M.widthAt(st, ev.u) / 2;
        const big = M.speedAt(st, Math.max(0, ev.u - 0.5)) <= 0.5;
        stoneGlow.set(ev.fall.id, t);
        spray(p.x + p.tx * 4, p.y + p.ty * 4, -p.ty, p.tx, p.tx, p.ty, hw, big);
        ripple(p.x + p.tx * hw * 0.8, p.y + p.ty * hw * 0.8, { r0: hw * 0.6, r1: hw * 2.8, a: 0.45, dur: 1.2, th: 0.18, col: [0.95, 0.98, 1] });
        break;
      }
      case 'grav': {
        if (!st) return;
        gravelHit.set(ev.g.id, t);
        const p = M.pointAtU(st, ev.u);
        for (let i = 0; i < (ev.accent ? 3 : 1); i++) particle({ x: p.x + (Math.random() - 0.5) * 14, y: p.y + (Math.random() - 0.5) * 14, vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 10, life: 0.5, size: 1.2, col: [0.9, 0.92, 0.95], a: 0.5, layer: 'over' });
        break;
      }
      case 'reedOn': {
        const r = reedState.get(ev.reed.id) || { on: 0, t0: t, tOff: 0 };
        r.on++; r.t0 = t; reedState.set(ev.reed.id, r);
        break;
      }
      case 'reedOff': {
        const id = ev.key.split(':')[1];
        const r = id && reedState.get(id);
        if (r) { r.on = Math.max(0, r.on - 1); r.tOff = t; }
        break;
      }
      case 'lanternStart': {
        lanternAppear.set(ev.L.id, t);
        if (!st) return;
        const p = M.pointAtU(st, ev.u);
        ripple(p.x, p.y, { r0: 4, r1: 26, a: 0.35, dur: 1.2, col: [1.0, 0.9, 0.7] });
        break;
      }
      case 'lanternEnd': {
        if (!st) return;
        const p = M.pointAtU(st, Math.min(ev.u, st.U));
        ghosts.push({ x: p.x, y: p.y, t0: t, kind: ev.putOut ? 'out' : ev.intoPond ? 'pond' : 'sink', rot: Math.atan2(p.ty, p.tx) });
        if (ev.putOut) for (let i = 0; i < 6; i++) particle({ x: p.x, y: p.y, vx: (Math.random() - 0.5) * 12, vy: -8 - Math.random() * 10, life: 1.4, size: 3, col: [0.75, 0.75, 0.78], a: 0.35, grow: 6, drag: 0.8 });
        break;
      }
      case 'ringStart': {
        ringPulse.set(ev.sid, t);
        const key = Math.round(ev.beat * 4);
        if (!starts.has(key)) starts.set(key, new Set());
        const set = starts.get(key);
        set.add(ev.sid);
        if (set.size >= 2) {
          const ids = [...set];
          const a = M.stream(V, ids[ids.length - 2]), b = M.stream(V, ids[ids.length - 1]);
          if (a && b) { const pa = markPos(a), pb = markPos(b); arcs.push({ ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y, t0: t }); }
        }
        if (starts.size > 64) { const ks = [...starts.keys()].sort((x, y) => x - y); for (let i = 0; i < ks.length - 32; i++) starts.delete(ks[i]); }
        break;
      }
      case 'fork': forkSpark.set(ev.sid + '@' + ev.u, t); break;
      case 'held': {
        if (!st) return;
        const p = M.pointAtU(st, ev.L.ua);
        ripple(p.x, p.y, { r0: 3, r1: 18, a: 0.3, dur: 0.9 });
        break;
      }
      case 'surge': surges.push({ sid: ev.sid, t0: t, u: ev.u }); break;
      case 'drop': {
        if (ev.onWater) ripple(ev.x, ev.y, { r0: 1, r1: ev.stone ? 18 : 11, a: ev.stone ? 0.5 : 0.35, dur: 0.9, th: 0.16 });
        else ripple(ev.x, ev.y, { r0: 1, r1: 6, a: 0.35, dur: 0.6, th: 0.3, col: [0.24, 0.22, 0.16], land: true });
        for (let i = 0; i < 3; i++) particle({ x: ev.x, y: ev.y, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, life: 0.35, size: 0.9, col: [0.85, 0.92, 1], a: 0.7, drag: 4 });
        if (ev.stone) stoneGlow.set(ev.stone.id, t);
        break;
      }
    }
  }
  // the flat marker stone at a pond's start, on the outer bank
  function markPos(st) {
    const p = M.pointAtU(st, 0), hw = M.widthAt(st, 0) / 2;
    const m = st.inner || 1;
    const nx = p.ty * m, ny = -p.tx * m;
    return { x: p.x + nx * (hw + 7), y: p.y + ny * (hw + 7) };
  }
  function update(Bheard, tSec, dt, V) {
    now = tSec;
    if (pending.length) {
      pending.sort((a, b) => a.beat - b.beat);
      let i = 0;
      while (i < pending.length && pending[i].beat <= Bheard + 0.01) { handle(pending[i], V); i++; }
      if (i) pending.splice(0, i);
      if (pending.length > 4000) pending.splice(0, pending.length - 4000);
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      const age = now - p.t0;
      if (age > p.life) { parts.splice(i, 1); continue; }
      if (age < 0) continue;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy *= k;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (let i = ripples.length - 1; i >= 0; i--) if (now - ripples[i].t0 > ripples[i].dur) ripples.splice(i, 1);
    for (let i = ghosts.length - 1; i >= 0; i--) if (now - ghosts[i].t0 > 1.6) ghosts.splice(i, 1);
    for (let i = arcs.length - 1; i >= 0; i--) if (now - arcs[i].t0 > 1.8) arcs.splice(i, 1);
    for (let i = surges.length - 1; i >= 0; i--) if (now - surges[i].t0 > 3) surges.splice(i, 1);
    if (ripples.length > 600) ripples.splice(0, ripples.length - 600);
    if (parts.length > 1500) parts.splice(0, parts.length - 1500);
  }
  function clear() {
    pending.length = 0; ripples.length = 0; parts.length = 0; ghosts.length = 0; arcs.length = 0; surges.length = 0;
    stoneGlow.clear(); gravelHit.clear(); reedState.clear(); ringPulse.clear(); forkSpark.clear(); lanternAppear.clear(); starts.clear();
  }
  const since = (map, id) => { const t0 = map.get(id); return t0 == null ? 1e9 : now - t0; };
  return {
    push, update, clear, ripple, particle, spray, markPos, since,
    get ripples() { return ripples; }, get parts() { return parts; }, get ghosts() { return ghosts; }, get arcs() { return arcs; },
    get surges() { return surges; },
    stoneGlow, gravelHit, reedState, ringPulse, forkSpark, lanternAppear,
    get now() { return now; },
  };
})();
