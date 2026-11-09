/* Riversong — lanterns riding the water, and the lookahead scheduler that turns their journeys into sound.
   Every lantern moves deterministically on the beat grid; we advance them a little ahead of the clock,
   emit events with exact beat times, and let the audio engine schedule them sample-accurately. */
'use strict';
RS.sim = (() => {
  const M = RS.model, U = RS.util;
  let V = null;                  // current valley
  let lanterns = [];
  let trig = new Map();          // sid -> { list, dec }
  let attach = new Map();        // stone id -> { sid, u }
  let frontier = 0;              // beat up to which events were emitted
  const listeners = [];          // event consumers: fn(ev)
  const MAX_TRANSIENT = 28, MAX_GATHER = 7;

  const emit = (type, beat, data) => { const ev = Object.assign({ type, beat }, data); for (const f of listeners) f(ev); };
  const isDec = (k) => k === 'dam' || k === 'branch';
  const ORDER = { reedB: 0, stone: 1, fall: 2, grav: 3, reedA: 4, ringStart: 5, dam: 6, branch: 7 };

  function setValley(v) {
    V = v;
    lanterns = [];
    rebuild();
  }
  // ---------- triggers ----------
  function rebuild() {
    if (!V) return;
    M.index(V);
    attach.clear();
    const R = RS.music.stoneRadius;
    for (const s of V.stones) {
      const h = M.hitWater(V, s.x, s.y, R(s.size) * 0.7);
      if (h) {
        // everything that sounds sits on the quarter-beat grid of its water
        let u = Math.round(h.u * 4) / 4;
        u = h.st.closed ? ((u % h.st.U) + h.st.U) % h.st.U : U.clamp(u, 0, h.st.U);
        attach.set(s.id, { sid: h.st.id, u });
      }
    }
    trig.clear();
    for (const st of V.streams) trig.set(st.id, { list: [], dec: [] });
    const add = (sid, t) => { const e = trig.get(sid); if (!e) return; const st = M.stream(V, sid); if (st.closed) t.u = ((t.u % st.U) + st.U) % st.U; e.list.push(t); };
    for (const s of V.stones) { const a = attach.get(s.id); if (a) add(a.sid, { u: a.u, kind: 'stone', ref: s }); }
    for (const f of V.falls) add(f.sid, { u: f.u, kind: 'fall', ref: f });
    for (const g of V.gravel) for (let u = g.a; u < g.b - 1e-6; u += 0.5) add(g.sid, { u, kind: 'grav', ref: g, accent: Math.abs(u - Math.round(u)) < 1e-6 });
    for (const r of V.reeds) { add(r.sid, { u: r.a, kind: 'reedA', ref: r }); add(r.sid, { u: r.b, kind: 'reedB', ref: r }); }
    for (const w of V.twigs) add(w.sid, { u: w.u, kind: 'dam', ref: w });
    for (const st of V.streams) if (st.closed) add(st.id, { u: 0, kind: 'ringStart', ref: st });
    // branch points: children grouped by attach position on the parent
    const groups = new Map();
    for (const st of V.streams) {
      const a = st.startAttach;
      if (!a || !trig.has(a.sid)) continue;
      const key = a.sid + '@' + a.u;
      if (!groups.has(key)) groups.set(key, { sid: a.sid, u: a.u, opts: [] });
      groups.get(key).opts.push(st.id);
    }
    for (const g of groups.values()) add(g.sid, { u: g.u, kind: 'branch', opts: g.opts, key: g.sid + '@' + g.u });
    for (const e of trig.values()) {
      e.list.sort((a, b) => a.u - b.u || ORDER[a.kind] - ORDER[b.kind]);
      e.dec = e.list.filter((t) => isDec(t.kind));
    }
  }
  const stoneAttach = (id) => attach.get(id);

  // ---------- lanterns ----------
  function homeOf(sid) { const r = M.rootOf(V, sid); return r ? r.id : null; }
  function anchor(L, sid, u, b, incl) {
    L.sid = sid; L.ua = u; L.ba = b; L.done = b; L.incl = incl; L.state = 'move';
    const st = M.stream(V, sid);
    L.segs.push({ sid, ua: u, ta: M.timeAt(st, u), b0: b, b1: Infinity, held: false });
  }
  function spawn(sid, u, beat, opts = {}) {
    const st = M.stream(V, sid);
    if (!st) return null;
    const L = {
      id: U.uid('L'), sid, ua: u, ba: beat, done: beat, incl: true, state: 'move', segs: [],
      transient: !!opts.transient, homeSid: opts.homeSid || homeOf(sid), departed: beat, cycle: 0,
      heldBy: null, heldAt: 0, nextEmit: Infinity, born: beat, owner: opts.owner || null, reeds: new Set(),
    };
    anchor(L, sid, u, beat, true);
    lanterns.push(L);
    if (!opts.silent) emit('lanternStart', beat, { L, sid, u });
    return L;
  }
  function closeSeg(L, b) { const s = L.segs[L.segs.length - 1]; if (s && s.b1 === Infinity) s.b1 = b; }
  function stopReeds(L, b) {
    for (const key of L.reeds) emit('reedOff', b, { key });
    L.reeds.clear();
  }
  function kill(L, b) {
    stopReeds(L, b);
    closeSeg(L, b);
    L.state = 'gone'; L.goneAt = b;
  }
  function respawn(L, b) {
    let home = L.homeSid && M.stream(V, L.homeSid);
    if (!home) { const h = homeOf(L.sid); home = h && M.stream(V, h); L.homeSid = h; }
    if (!home) return kill(L, b);
    stopReeds(L, b);
    closeSeg(L, b);
    L.cycle = b - L.departed;
    L.departed = b;
    anchor(L, home.id, 0, b, true);
    emit('lanternStart', b, { L, sid: home.id, u: 0 });
  }
  function decide(L, st, dec, b) {
    closeSeg(L, b);
    if (!dec) { // reached the end of this water
      if (st.closed) {
        if (L.transient) { emit('lanternEnd', b, { L, sid: st.id, u: st.U }); return kill(L, b); }
        anchor(L, st.id, 0, b, true);
        return;
      }
      const ea = st.endAttach, tg = ea && M.stream(V, ea.sid);
      if (tg && !tg.closed && ea.u < tg.U) {
        stopReeds(L, b);
        anchor(L, tg.id, ea.u, b, true);
        return;
      }
      emit('lanternEnd', b, { L, sid: st.id, u: st.U, intoPond: !!(tg && tg.closed) });
      if (L.transient) return kill(L, b);
      return respawn(L, b);
    }
    if (dec.kind === 'dam') {
      stopReeds(L, b);
      L.state = 'held'; L.heldBy = dec.ref.id; L.heldAt = b; L.ua = dec.u; L.ba = b;
      L.segs.push({ sid: st.id, ua: dec.u, ta: M.timeAt(st, dec.u), b0: b, b1: Infinity, held: true });
      if (!L.transient) {
        const home = L.homeSid && M.stream(V, L.homeSid);
        const raw = home && home.closed ? home.D : L.cycle > 0 ? L.cycle : b - L.departed;
        const P = Math.max(2, Math.round(2 * raw) / 2);
        L.emitEvery = P;
        L.nextEmit = b + P;
      }
      emit('held', b, { L, twig: dec.ref });
      return;
    }
    if (dec.kind === 'branch') {
      const n = V.toggles[dec.key] || 0;
      const opts = [null].concat(dec.opts);
      const pick = opts[n % opts.length];
      V.toggles[dec.key] = n + 1;
      emit('fork', b, { sid: st.id, u: dec.u, pick, L });
      if (!pick || !M.stream(V, pick)) { anchor(L, st.id, dec.u, b, false); return; }
      stopReeds(L, b);
      anchor(L, pick, 0, b, true);
    }
  }
  function emitRange(L, st, list, ta, uFrom, uTo, inclFrom) {
    for (const t of list) {
      if (t.u < uFrom - 1e-9 || (!inclFrom && t.u <= uFrom + 1e-9)) continue;
      if (t.u > uTo + 1e-9) break;
      if (isDec(t.kind)) continue;
      const beat = L.ba + (M.timeAt(st, t.u) - ta);
      const qb = Math.round(beat * 64) / 64; // keep everything on a fine grid
      switch (t.kind) {
        case 'stone': emit('stone', qb, { stone: t.ref, sid: st.id, u: t.u, L }); break;
        case 'fall': emit('fall', qb, { fall: t.ref, sid: st.id, u: t.u, L }); break;
        case 'grav': emit('grav', qb, { g: t.ref, sid: st.id, u: t.u, accent: t.accent, L }); break;
        case 'reedA': {
          if (L.transient && L.reeds.size >= 1) break;
          const key = L.id + ':' + t.ref.id;
          if (!L.reeds.has(key)) { L.reeds.add(key); emit('reedOn', qb, { key, reed: t.ref, sid: st.id, L }); }
          break;
        }
        case 'reedB': {
          const key = L.id + ':' + t.ref.id;
          if (L.reeds.has(key)) { L.reeds.delete(key); emit('reedOff', qb, { key, reed: t.ref }); }
          break;
        }
        case 'ringStart': if (!L.transient) emit('ringStart', qb, { sid: st.id, L }); break;
      }
    }
  }
  function advance(L, H) {
    let guard = 0;
    while (guard++ < 64) {
      if (L.state !== 'move' || L.ba > H) return;
      const st = M.stream(V, L.sid);
      if (!st) { if (L.transient) return kill(L, L.done); respawn(L, Math.max(L.done, L.ba)); continue; }
      const tr = trig.get(st.id) || { list: [], dec: [] };
      const ta = M.timeAt(st, L.ua);
      let dU = st.U, dec = null;
      for (const d of tr.dec) {
        if (d.u > L.ua + 1e-9 || (L.incl && Math.abs(d.u - L.ua) < 1e-9)) { dU = d.u; dec = d; break; }
      }
      const bd = L.ba + (M.timeAt(st, dU) - ta);
      const segEnd = Math.min(bd, H);
      const uFrom = L.done <= L.ba ? L.ua : M.uAtTime(st, ta + (L.done - L.ba));
      const uTo = segEnd >= bd ? dU : M.uAtTime(st, ta + (segEnd - L.ba));
      const inclFrom = L.incl && L.done <= L.ba;
      emitRange(L, st, tr.list, ta, uFrom, uTo, inclFrom);
      if (segEnd >= L.ba) L.incl = false;
      L.done = Math.max(L.done, segEnd);
      if (bd <= H) decide(L, st, dec, bd);
      else return;
    }
    // runaway guard (should not happen): park the lantern at home on the next beat
    respawn(L, Math.ceil(L.done + 1));
  }
  function advanceAll(H) {
    if (!V) return;
    for (let i = 0; i < lanterns.length; i++) advance(lanterns[i], H);
    // springs keep sending lanterns while theirs are held at a dam: they gather
    for (let i = 0; i < lanterns.length; i++) {
      const L = lanterns[i];
      if (L.state !== 'held' || L.transient) continue;
      let guard = 0;
      while (L.nextEmit <= H && guard++ < 4) {
        const t = L.nextEmit;
        L.nextEmit += L.emitEvery || 4;
        const gathered = lanterns.filter((x) => x.state === 'held' && x.heldBy === L.heldBy).length;
        const transients = lanterns.filter((x) => x.transient && x.state !== 'gone').length;
        if (gathered >= MAX_GATHER || transients >= MAX_TRANSIENT) continue;
        const home = L.homeSid && M.stream(V, L.homeSid);
        if (!home) break;
        const T = spawn(home.id, 0, t, { transient: true, homeSid: home.id, owner: L.id });
        if (T) advance(T, H);
      }
    }
    frontier = H;
    // forget lanterns that are long gone and old path pieces
    const keepFrom = H - 6;
    lanterns = lanterns.filter((L) => L.state !== 'gone' || L.goneAt > keepFrom);
    for (const L of lanterns) if (L.segs.length > 6) { let k = 0; while (k < L.segs.length - 2 && L.segs[k].b1 < keepFrom) k++; if (k) L.segs.splice(0, k); }
  }
  // lift a twig: everyone gathered behind it pours out, a sixteenth apart
  function release(twigId, b) {
    const held = lanterns.filter((L) => L.state === 'held' && L.heldBy === twigId).sort((a, c) => a.heldAt - c.heldAt);
    held.forEach((L, i) => {
      closeSeg(L, b + i * 0.25);
      L.heldBy = null; L.nextEmit = Infinity;
      anchor(L, L.sid, L.ua, b + i * 0.25, false);
    });
    return held.length;
  }

  // ---------- where is a lantern (for drawing) ----------
  function lanternPos(L, B) {
    let seg = null;
    for (let i = L.segs.length - 1; i >= 0; i--) if (L.segs[i].b0 <= B) { seg = L.segs[i]; break; }
    if (!seg) seg = L.segs[0];
    if (!seg) return null;
    const st = M.stream(V, seg.sid);
    if (!st) return null;
    let u;
    if (seg.held || B <= seg.b0) u = seg.ua;
    else {
      const bb = Math.min(B, seg.b1);
      u = M.uAtTime(st, seg.ta + (bb - seg.b0));
    }
    return { st, u, held: seg.held, waiting: B < seg.b0 };
  }
  function exportLanterns(B) {
    const out = [];
    for (const L of lanterns) {
      if (L.transient || L.state === 'gone') continue;
      const p = lanternPos(L, B);
      if (!p) continue;
      out.push({ sid: p.st.id, u: Math.round(p.u * 1000) / 1000, held: L.state === 'held' });
    }
    return out;
  }
  function loadLanterns(list, B) {
    for (const o of list) if (M.stream(V, o.sid)) spawn(o.sid, o.u, B, { silent: true });
  }
  // re-anchoring after an edit keeps lanterns on the grid: a quarter-beat position, the next sixteenth
  const q4 = (b) => Math.ceil(b * 4 - 1e-6) / 4;
  function snapU(st, u) { let v = Math.round(u * 4) / 4; if (st.closed) v = ((v % st.U) + st.U) % st.U; else v = U.clamp(v, 0, st.U); return v; }
  function uAtFrontier(L, st) {
    if (L.state === 'held' || L.done <= L.ba) return L.ua;
    return Math.min(st.U, M.uAtTime(st, M.timeAt(st, L.ua) + (L.done - L.ba)));
  }
  function reanchor(L, sid, u, b) {
    const st = M.stream(V, sid);
    const wasHeld = L.state === 'held';
    closeSeg(L, b);
    if (wasHeld) {
      L.sid = sid; L.ua = u; L.ba = b;
      L.segs.push({ sid, ua: u, ta: M.timeAt(st, u), b0: b, b1: Infinity, held: true });
      return;
    }
    anchor(L, sid, snapU(st, u), q4(b), false);
  }
  // speed changes: remember where everyone is under the old timing, then re-anchor under the new one
  function capture(sid) {
    const st = M.stream(V, sid);
    return lanterns.filter((L) => L.state !== 'gone' && L.sid === sid).map((L) => ({ L, u: uAtFrontier(L, st), waiting: L.ba > frontier }));
  }
  function restore(recs) {
    for (const r of recs) {
      if (r.waiting) { const st = M.stream(V, r.L.sid); const s = r.L.segs[r.L.segs.length - 1]; if (s) s.ta = M.timeAt(st, s.ua); continue; }
      reanchor(r.L, r.L.sid, r.u, frontier);
    }
  }
  // after water was split/erased: carry lanterns over to the new pieces
  function remapLanterns(changes, b) {
    for (const L of lanterns) {
      if (L.state === 'gone') continue;
      const ch = changes.get(L.sid);
      if (L.homeSid && changes.has(L.homeSid)) {
        const r = changes.get(L.homeSid).remap(0);
        L.homeSid = r ? homeOf(r.sid) : null;
      }
      if (!ch) continue;
      const uNow = uAtFrontier(L, ch.old);
      const r = ch.remap(uNow);
      stopReeds(L, b);
      if (!r) {
        closeSeg(L, b);
        const home = L.homeSid && M.stream(V, L.homeSid);
        if (L.transient || !home) { L.state = 'gone'; L.goneAt = b; continue; }
        anchor(L, home.id, 0, Math.ceil(b), true);
        continue;
      }
      if (!L.homeSid || !M.stream(V, L.homeSid)) L.homeSid = homeOf(r.sid);
      reanchor(L, r.sid, r.u, b);
    }
  }
  function removeLantern(L, b) { kill(L, b); emit('lanternEnd', b, { L, sid: L.sid, u: L.ua, putOut: true }); }
  function lanternsOn(sid) { return lanterns.filter((L) => L.state !== 'gone' && L.sid === sid); }
  function nearestLantern(x, y, B, maxd) {
    let best = null, bd = maxd;
    for (const L of lanterns) {
      if (L.state === 'gone') continue;
      const p = lanternPos(L, B);
      if (!p) continue;
      const q = M.pointAtU(p.st, p.u);
      const d = Math.hypot(q.x - x, q.y - y);
      if (d < bd) { bd = d; best = L; }
    }
    return best;
  }
  return {
    setValley, rebuild, spawn, advanceAll, release, lanternPos, exportLanterns, loadLanterns, remapLanterns,
    removeLantern, lanternsOn, nearestLantern, stoneAttach, kill, capture, restore, homeOf,
    get lanterns() { return lanterns; },
    get frontier() { return frontier; },
    set frontier(b) { frontier = b; },
    get trig() { return trig; },
    on(f) { listeners.push(f); },
  };
})();
