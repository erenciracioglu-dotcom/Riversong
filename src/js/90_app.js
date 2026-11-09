/* Riversong — the valley in play: edits, timing, saving, and the loops that keep it flowing. */
'use strict';
RS.app = (() => {
  const M = RS.model, U = RS.util, MU = RS.music;
  let V = null;
  let draft = null;
  let mode = 1;
  let saveAt = 0, dirty = false;
  let lastFrame = performance.now() / 1000;
  let resized = true;
  let ambT = 0;

  const nextBeat = () => Math.ceil(Math.max(RS.sim.frontier, RS.clock.beat()) + 0.02);
  const panOf = (x) => RS.input.panX(x);
  function gainOf(x, y) {
    const r = RS.render.viewRect(0);
    const dx = Math.max(0, r[0] - x, x - r[2]), dy = Math.max(0, r[1] - y, y - r[3]);
    const d = Math.hypot(dx, dy) * RS.render.cam.zoom;
    return Math.max(0.5, 1 / (1 + d / 900));
  }
  const pointOf = (sid, u) => { const st = M.stream(V, sid); return st ? M.pointAtU(st, Math.min(u, st.U)) : { x: 0, y: 0 }; };

  // ---------- events from the water to sound & picture ----------
  function route(ev) {
    switch (ev.type) {
      case 'stone': {
        const s = ev.stone;
        RS.audio.stone(s.size, ev.beat, { pan: panOf(s.x), vel: gainOf(s.x, s.y) * (ev.L && ev.L.transient ? 0.85 : 1) });
        break;
      }
      case 'fall': {
        const st = M.stream(V, ev.sid);
        if (!st) break;
        const sp = M.speedAt(st, Math.max(0, ev.u - 0.5));
        const p = M.pointAtU(st, ev.u);
        RS.audio.fall(sp <= 0.5 ? 2 : sp >= 2 ? 0 : 1, ev.beat, { pan: panOf(p.x) });
        break;
      }
      case 'grav': { const p = pointOf(ev.sid, ev.u); RS.audio.gravel(ev.beat, ev.accent, { pan: panOf(p.x) }); break; }
      case 'reedOn': {
        const r = ev.reed, p = pointOf(r.sid, (r.a + r.b) / 2);
        RS.audio.reedOn(ev.key, r.size, ev.beat, { pan: panOf(p.x), vel: gainOf(p.x, p.y) });
        break;
      }
      case 'reedOff': RS.audio.reedOff(ev.key, ev.beat); break;
    }
    RS.fx.push(ev);
  }

  // ---------- opening valleys ----------
  function open(valley) {
    if (V && V !== valley) { saveNow(true); RS.audio.silenceReeds(RS.clock.beat() + 0.05); }
    V = valley;
    M.index(V);
    RS.clock.setBpm(V.bpm || 84);
    RS.audio.setBpm(V.bpm || 84);
    RS.fx.clear();
    RS.sim.setValley(V);
    RS.render.setValley(V);
    RS.sim.frontier = RS.clock.beat();
    const B0 = Math.ceil(RS.clock.beat() + 0.1);
    if (V.lanterns && V.lanterns.length) RS.sim.loadLanterns(V.lanterns, B0);
    else for (const st of V.streams) if (!st.startAttach) RS.sim.spawn(st.id, 0, B0, { silent: true });
    mode = MU.modeAt(V.tod);
    RS.audio.mode = mode;
    RS.render.home(true);
    RS.store.setCurrent(V.id);
    if (V.twigs.length) RS.hints.want('lift');
    updateAmbience();
  }
  function openById(id, noSave) {
    const v = RS.store.load(id);
    if (!v) return;
    if (noSave) V = null;
    open(v);
  }
  function newValley(noSave) {
    if (noSave) V = null;
    const v = M.newValley({ tod: V ? V.tod : 0.3 });
    open(v);
    saveNow(true);
  }

  // ---------- water ----------
  function makeOpen(raw, parent, endAttach) {
    let pts = U.chaikin(raw, 2, false);
    pts = U.resample(pts, M.STEP, false);
    if (U.polyLength(pts, false) < M.MIN_LEN) return null;
    return M.makeStream({ pts, startAttach: parent ? { sid: parent.sid, u: parent.u } : null, endAttach });
  }
  function makeRing(raw) {
    let pts = U.chaikin(raw, 3, true);
    pts = U.resample(pts, M.STEP, true);
    if (U.polyLength(pts, true) < 1.4 * M.V0) return null;
    return M.makeStream({ pts, closed: true });
  }
  function finishStroke(raw, parent, c) {
    if (!V || raw.length < 2) return;
    const made = [];
    if (c && c.type === 'self') {
      if (c.nearStart && !parent) { const ring = makeRing(raw); if (ring) made.push(ring); }
      else {
        const ring = makeRing(raw.slice(c.idx));
        if (ring) {
          made.push(ring);
          const tail = makeOpen(raw.slice(0, c.idx + 1), parent, { sid: ring.id, u: 0 });
          if (tail) made.push(tail);
        }
      }
    } else if (c && c.type === 'stream') {
      const tg = M.stream(V, c.sid);
      let ut = M.snapHalf(tg, c.u);
      if (!tg.closed && ut >= tg.U) ut = tg.U - 0.5;
      const P = M.pointAtU(tg, ut);
      const st = makeOpen(raw.concat([[P.x, P.y]]), parent, { sid: tg.id, u: ut });
      if (st) made.push(st);
    } else {
      const st = makeOpen(raw, parent, null);
      if (st) made.push(st);
    }
    if (!made.length) { RS.ui.nope(RS.input.hover.x, RS.input.hover.y); return; }
    for (const st of made) V.streams.push(st);
    M.index(V);
    changed();
    const B = nextBeat();
    for (const st of made) if (!st.startAttach) RS.sim.spawn(st.id, 0, B);
    RS.hints.did('draw');
    if (made.some((s) => s.closed)) RS.hints.did('pond');
    if (parent) RS.hints.did('split');
    updateAmbience();
  }
  function keepRanges(st, cells) {
    const n = st.U, keep = [];
    if (!st.closed) {
      let a = 0;
      for (let i = 0; i < n; i++) if (cells.has(i)) { if (i > a) keep.push([a, i]); a = i + 1; }
      if (a < n) keep.push([a, n]);
      return keep;
    }
    const first = [...cells][0];
    let run = null;
    for (let k = 1; k <= n; k++) {
      const i = (first + k) % n, abs = first + k;
      if (!cells.has(i)) { if (run == null) run = abs; }
      else if (run != null) { keep.push(run >= n ? [run - n, abs - n] : [run, abs]); run = null; }
    }
    return keep;
  }
  function eraseAt(x, y, R) {
    if (!V) return;
    let any = false;
    const changes = new Map();
    const hadParent = new Set(V.streams.filter((s) => s.startAttach).map((s) => s.id));
    for (const st of V.streams.slice()) {
      const bb = st.bbox;
      if (x < bb[0] - R - 30 || x > bb[2] + R + 30 || y < bb[1] - R - 30 || y > bb[3] + R + 30) continue;
      const cells = new Set();
      const unit = st.k * M.V0;
      for (let i = 0; i < st.pts.length; i++) {
        const p = st.pts[i];
        if (Math.hypot(p[0] - x, p[1] - y) < R + 4) cells.add(Math.min(st.U - 1, Math.floor(st.cum[i] / unit)));
      }
      if (!cells.size) continue;
      const res = M.splitStream(V, st, keepRanges(st, cells));
      changes.set(st.id, { old: st, remap: res.remap, pieces: res.pieces });
      any = true;
    }
    const n0 = V.stones.length;
    V.stones = V.stones.filter((s) => Math.hypot(s.x - x, s.y - y) > R * 0.85);
    if (V.stones.length !== n0) any = true;
    if (changes.size) {
      RS.sim.rebuild();
      RS.sim.remapLanterns(changes, RS.sim.frontier);
      const B = nextBeat();
      for (const st of V.streams) {
        if (st.closed || st.startAttach) continue;
        const fresh = [...changes.values()].some((c) => c.pieces.includes(st)) || hadParent.has(st.id);
        if (!fresh) continue;
        const has = RS.sim.lanterns.some((L) => L.state !== 'gone' && !L.transient && (L.sid === st.id || L.homeSid === st.id));
        if (!has) RS.sim.spawn(st.id, 0, B);
      }
      RS.render.pruneMeshes();
    }
    if (any) { changed(); updateAmbience(); }
  }
  function commitErase() { RS.hints.did('rub'); }

  // ---------- speed ----------
  const modU = (st, i) => (st.closed ? ((i % st.U) + st.U) % st.U : i);
  function changeSpeedAt(st, u, dir) {
    let i = Math.floor(st.closed ? ((u % st.U) + st.U) % st.U : U.clamp(u, 0, st.U - 1e-6));
    let a, b;
    const s0 = st.speed[i];
    if (s0 !== 1) {
      a = i; b = i + 1;
      const lim = st.closed ? st.U : 1e9;
      while ((st.closed ? i - a < lim - 1 : a > 0) && st.speed[modU(st, a - 1)] === s0) a--;
      while ((st.closed ? b - a < lim : b < st.U) && st.speed[modU(st, b)] === s0) b++;
    } else {
      a = i - 1; b = i + 3;
      if (!st.closed) { a = U.clamp(a, 0, st.U - 1); b = U.clamp(b, a + 1, st.U); }
    }
    changeSpeed(st, a, b, dir);
  }
  function changeSpeed(st, a, b, dir) {
    const recs = RS.sim.capture(st.id);
    let any = false;
    for (let i = a; i < b; i++) {
      const j = modU(st, i);
      if (j < 0 || j >= st.U) continue;
      const s = st.speed[j];
      const ns = U.clamp(dir > 0 ? s / 2 : s * 2, 0.5, 2);
      if (ns !== s) { st.speed[j] = ns; any = true; }
    }
    if (!any) { const p = M.pointAtU(st, a + 0.5), q = RS.render.toScreen(p.x, p.y); RS.ui.nope(q.x, q.y); return; }
    M.buildTime(st);
    st.ver++;
    RS.sim.restore(recs);
    changed();
    RS.hints.did('speed');
  }

  // ---------- stones, gravel, falls ----------
  function settleTarget(x, y, size) {
    if (!V) return null;
    const r = MU.stoneRadius(size);
    const h = M.hitWater(V, x, y, r * 0.7);
    if (!h) return null;
    const st = h.st;
    const u2 = M.snapHalf(st, h.u);
    const P = M.pointAtU(st, h.u), P2 = M.pointAtU(st, u2);
    let lat = (x - P.x) * -P.ty + (y - P.y) * P.tx;
    const hw = M.widthAt(st, u2) / 2;
    if (!h.inPond) lat = U.clamp(lat, -hw * 0.8, hw * 0.8);
    return { x: P2.x - P2.ty * lat, y: P2.y + P2.tx * lat, sid: st.id, u: u2 };
  }
  function placeStone(x, y, size) {
    const s = { id: U.uid('t'), x, y, size, seed: Math.random() };
    const t = settleTarget(x, y, size);
    if (t) { s._anim = { x, y, t0: RS.fx.now }; s.x = t.x; s.y = t.y; }
    V.stones.push(s);
    changed();
    RS.hints.did('stone');
  }
  function moveStone(s, x, y) {
    const ox = s.x, oy = s.y;
    s.x = x; s.y = y;
    const t = settleTarget(x, y, s.size);
    if (t) { s.x = t.x; s.y = t.y; }
    s._anim = { x: t ? x : ox, y: t ? y : oy, t0: RS.fx.now };
    if (!t) s._anim = null;
    changed();
  }
  function removeStone(s) { V.stones = V.stones.filter((o) => o !== s); changed(); }
  function resizeStone(s, size) {
    s.size = size; s._grow = RS.fx.now;
    RS.audio.preview(size, { pan: panOf(s.x) });
    const t = settleTarget(s.x, s.y, size);
    if (t) { s.x = t.x; s.y = t.y; }
    changed();
  }
  function placeGravel(sid, a, b) {
    V.gravel = V.gravel.filter((g) => !(g.sid === sid && g.a < b && a < g.b));
    V.gravel.push({ id: U.uid('g'), sid, a, b, seed: Math.floor(Math.random() * 1e6) });
    changed();
    RS.hints.did('gravel');
  }
  function placeFall(sid, u) {
    if (V.falls.some((f) => f.sid === sid && Math.abs(f.u - u) < 0.5)) return;
    V.falls.push({ id: U.uid('f'), sid, u, seed: Math.random() });
    changed();
    const st = M.stream(V, sid), p = M.pointAtU(st, u);
    RS.fx.spray(p.x, p.y, -p.ty, p.tx, p.tx, p.ty, M.widthAt(st, u) / 2, false);
  }

  // ---------- reeds ----------
  function placeReed(o) {
    V.reeds = V.reeds.filter((r) => !(r.sid === o.sid && r.side === o.side && r.a < o.b && o.a < r.b));
    V.reeds.push({ id: U.uid('r'), sid: o.sid, a: o.a, b: o.b, side: o.side, size: o.size, seed: Math.floor(Math.random() * 1e6) });
    changed();
    RS.hints.did('reed');
  }
  function resizeReed(rd, size) {
    rd.size = size; rd._key = null;
    const p = pointOf(rd.sid, (rd.a + rd.b) / 2);
    RS.audio.reedPreview(size, { pan: panOf(p.x) });
    changed();
  }

  // ---------- twigs ----------
  function placeTwig(sid, u) {
    if (V.twigs.some((w) => w.sid === sid && Math.abs(w.u - u) < 0.5)) return;
    const w = { id: U.uid('w'), sid, u, seed: Math.random() };
    V.twigs.push(w);
    changed();
    const p = pointOf(sid, u);
    RS.fx.ripple(p.x, p.y, { r0: 4, r1: 26, a: 0.4, dur: 1 });
    RS.hints.did('twig');
    RS.hints.want('lift');
  }
  function liftTwig(w) {
    if (!V.twigs.includes(w)) return;
    const B = nextBeat();
    const n = RS.sim.release(w.id, B);
    V.twigs = V.twigs.filter((x) => x !== w);
    changed();
    const p = pointOf(w.sid, w.u);
    RS.fx.ripple(p.x, p.y, { r0: 6, r1: 40, a: 0.5, dur: 1.2 });
    if (n > 0) {
      RS.audio.release(B, { pan: panOf(p.x) });
      RS.fx.push({ type: 'surge', beat: B, sid: w.sid, u: w.u });
      for (const st of V.streams) if (st.id === w.sid || (st.endAttach && st.endAttach.sid === w.sid)) RS.fx.push({ type: 'surge', beat: B + 1, sid: st.id, u: 0 });
    }
    RS.hints.did('lift');
  }

  // ---------- lanterns ----------
  function placeLantern(sid, u) {
    const B = nextBeat();
    RS.sim.spawn(sid, u, B);
    const p = pointOf(sid, u);
    RS.audio.bell(B, { pan: panOf(p.x) });
    RS.hints.did('lantern');
  }
  function moveLantern(L, sid, u) { RS.sim.kill(L, RS.sim.frontier); placeLantern(sid, u); }
  function putOutLantern(L) { RS.sim.removeLantern(L, RS.sim.frontier); }
  function placeFromTray(id, cx, cy) {
    const w = RS.render.toWorld(cx, cy);
    if (id === 'stone') return placeStone(w.x, w.y, 0);
    const h = M.hitWater(V, w.x, w.y, id === 'reed' ? 40 : 6 / RS.render.cam.zoom);
    if (!h) { RS.ui.nope(cx, cy); return; }
    if (id === 'twig') placeTwig(h.st.id, M.snapHalf(h.st, h.u));
    else if (id === 'lantern') placeLantern(h.st.id, M.snapHalf(h.st, h.u));
    else if (id === 'reed') {
      const P = M.pointAtU(h.st, h.u);
      const side = Math.sign((w.x - P.x) * -P.ty + (w.y - P.y) * P.tx) || 1;
      let a = Math.round((h.u - 1) * 2) / 2;
      if (!h.st.closed) a = U.clamp(a, 0, Math.max(0, h.st.U - 2));
      placeReed({ sid: h.st.id, a, b: Math.min(a + 2, h.st.closed ? a + 2 : h.st.U), side, size: 4 });
    }
  }

  // ---------- light ----------
  function setTod(t) {
    if (!V) return;
    V.tod = t;
    const m = MU.modeAt(t);
    if (m !== mode) { mode = m; RS.audio.retune(m, nextBeat()); }
    dirty = true; saveAt = performance.now() + 2000;
  }

  // ---------- bookkeeping ----------
  function changed() {
    RS.sim.rebuild();
    V.updated = Date.now();
    dirty = true;
    saveAt = performance.now() + 1500;
  }
  function lanternSnapshot() { return RS.sim.exportLanterns(Math.floor(RS.clock.heardBeat())); }
  function makeThumb() {
    try {
      const sky = RS.render.skyAt(V.tod);
      const B = RS.clock.heardBeat(), tS = RS.fx.now;
      const c = RS.render.thumbnail(384, 240, sky, B, tS, (tb, t) => RS.scene.build(api, B, tS, 0, sky, { batches: tb, rect: [-60, -60, M.WORLD.w + 60, M.WORLD.h + 60], zoom: t.zoom, thumb: true }));
      return c ? c.toDataURL('image/jpeg', 0.8) : null;
    } catch (e) { console.warn('thumbnail', e); return null; }
  }
  function saveNow(withThumb) {
    if (!V) return;
    const ok = RS.store.save(V, lanternSnapshot(), withThumb ? makeThumb() : null);
    if (!ok) RS.ui.showToast(RS.i18n.t().saveFull, 4000);
    dirty = false;
  }
  function updateAmbience() {
    if (!V) return;
    let L = 0;
    for (const st of V.streams) L += st.len;
    RS.audio.setAmbience(Math.min(0.06, L > 0 ? 0.012 + (L / 30000) * 0.05 : 0));
  }
  function toggleMute() {
    RS.audio.setMuted(!RS.audio.muted);
    RS.ui.showToast(RS.audio.muted ? RS.i18n.t().muted : RS.i18n.t().unmuted);
    if (!RS.audio.muted) updateAmbience();
  }
  let unlocked = false;
  function userGesture() {
    RS.audio.resume().then(() => { if (!unlocked && RS.audio.running) { unlocked = true; updateAmbience(); } });
  }
  function setDraft(d) { draft = d; }

  // ---------- the two loops ----------
  function tick() {
    if (!V) return;
    RS.clock.sync();
    const look = document.hidden ? 1.6 : 0.14;
    const H = RS.clock.beat(RS.clock.now() + look);
    if (H > RS.sim.frontier) RS.sim.advanceAll(H);
    RS.rain.tick(V, RS.clock.beat());
  }
  let lastCW = 0, lastCH = 0;
  function frame() {
    const t = performance.now() / 1000;
    const dt = U.clamp(t - lastFrame, 0, 0.1);
    lastFrame = t;
    const cv = document.getElementById('gl');
    if (cv.clientWidth !== lastCW || cv.clientHeight !== lastCH) { lastCW = cv.clientWidth; lastCH = cv.clientHeight; resized = true; }
    if (resized) { RS.render.resize(); RS.ui.resize(); resized = false; }
    tick();
    RS.render.updateCamera(dt);
    RS.input.update();
    if (V) {
      const B = RS.clock.heardBeat();
      RS.fx.update(B, t, dt, V);
      const sky = RS.render.skyAt(V.tod);
      const lights = RS.scene.build(api, B, t, dt, sky);
      RS.render.frame(B, t, sky, { draft, lights });
      if (dirty && performance.now() > saveAt && !RS.input.gesture) saveNow(false);
      if (t - ambT > 5) { ambT = t; updateAmbience(); }
    }
    RS.ui.draw(dt, t);
    requestAnimationFrame(frame);
  }
  function start() {
    RS.sim.on(route);
    window.addEventListener('resize', () => { resized = true; });
    document.addEventListener('visibilitychange', () => { if (document.hidden && V) saveNow(false); });
    window.addEventListener('pagehide', () => { if (V) saveNow(false); });
    // a steady scheduler that keeps going when the tab is in the background
    try {
      const src = 'let id=null;onmessage=function(e){if(e.data==="go"&&!id)id=setInterval(function(){postMessage(0)},25)}';
      const wk = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      wk.onmessage = tick;
      wk.postMessage('go');
    } catch (e) { setInterval(tick, 25); }
    requestAnimationFrame(frame);
  }

  const api = {
    get valley() { return V; },
    get draft() { return draft; },
    open, openById, newValley, start, finishStroke, eraseAt, commitErase, changeSpeed, changeSpeedAt,
    settleTarget, placeStone, moveStone, removeStone, resizeStone, placeGravel, placeFall, placeReed, resizeReed,
    placeTwig, liftTwig, placeLantern, moveLantern, putOutLantern, placeFromTray, setTod, saveNow, lanternSnapshot,
    toggleMute, userGesture, setDraft, nextBeat,
  };
  return api;
})();
