/* Riversong — hands on the valley: drawing and rubbing out water, placing things, pinching, rain, zoom. */
'use strict';
RS.input = (() => {
  const M = RS.model, U = RS.util, MU = RS.music;
  const R = () => RS.render, A = () => RS.app;
  let canvas = null;
  let tool = null;
  const ptrs = new Map();
  let g = null;
  let space = false;
  const hover = { x: -1e4, y: -1e4, inside: false, type: 'mouse', t: 0 };
  let wheelAcc = 0, wheelSid = null, wheelT = 0;
  const DRAG = 7;
  const now = () => performance.now() / 1000;
  const V = () => A().valley;

  function setTool(t) { tool = tool === t ? null : t; RS.ui.toolChanged(tool); }
  function dropTool() { tool = null; RS.ui.toolChanged(null); }
  const W = (cx, cy) => R().toWorld(cx, cy);
  const zoom = () => R().cam.zoom;

  // ---------- what is under the hand ----------
  function hitTest(w) {
    const v = V(), z = zoom();
    const B = RS.clock.heardBeat();
    for (const t of v.twigs) {
      const st = M.stream(v, t.sid);
      if (!st) continue;
      const p = M.pointAtU(st, t.u), hw = M.widthAt(st, t.u) / 2;
      const dx = w.x - p.x, dy = w.y - p.y;
      const along = dx * p.tx + dy * p.ty, across = Math.abs(-dx * p.ty + dy * p.tx);
      // the twig itself, or the little crowd of lanterns waiting behind it
      if (along < 6 + 6 / z && along > -(18 + 8 / z) && across < hw * 1.45) return { type: 'twig', t };
    }
    const L = RS.sim.nearestLantern(w.x, w.y, B, 9 + 8 / z);
    if (L && L.state !== 'held') return { type: 'lantern', L };
    let best = null, bd = 1e9;
    for (const s of v.stones) {
      const d = Math.hypot(s.x - w.x, s.y - w.y) - MU.stoneRadius(s.size);
      if (d < 4 / z + 2 && d < bd) { bd = d; best = s; }
    }
    if (best) return { type: 'stone', s: best };
    const h = M.hitWater(v, w.x, w.y, 2 / z);
    if (h) return { type: 'water', h };
    for (const rd of v.reeds) {
      const st = M.stream(v, rd.sid);
      if (!st) continue;
      const nr = M.nearest(st, w.x, w.y);
      const hw = M.widthAt(st, nr.u) / 2;
      const side = Math.sign((w.x - nr.x) * -M.pointAtU(st, nr.u).ty + (w.y - nr.y) * M.pointAtU(st, nr.u).tx) || 1;
      if (nr.d < hw + MU.reedHeight(rd.size) && side === rd.side && nr.u >= rd.a - 0.2 && nr.u <= rd.b + 0.2) return { type: 'reed', rd };
    }
    return { type: 'land' };
  }
  const onWater = (w) => !!M.hitWater(V(), w.x, w.y, 3 / zoom());

  // ---------- pointer events ----------
  function onDown(e) {
    if (RS.ui.blocking()) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    A().userGesture();
    const p = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t0: now(), button: e.button, type: e.pointerType };
    ptrs.set(e.pointerId, p);
    hover.type = e.pointerType; hover.x = e.clientX; hover.y = e.clientY; hover.inside = true;
    if (ptrs.size === 2) { startTwo(); return; }
    if (ptrs.size > 2) return;
    const ui = RS.ui.hit(e.clientX, e.clientY);
    if (ui) { g = { kind: 'ui', ui, p, moved: false, t0: now() }; RS.ui.press(ui, e.clientX, e.clientY); return; }
    const w = W(e.clientX, e.clientY);
    if (e.button === 1 || space || (e.button === 2 && !onWater(w))) { g = { kind: 'pan', lx: e.clientX, ly: e.clientY }; return; }
    if (e.button === 2) { g = { kind: 'rub', last: w, t: 0 }; rub(w, true); return; }
    g = { kind: 'press', p, w, t0: now(), hit: tool ? null : hitTest(w), moved: false, path: [{ x: e.clientX, y: e.clientY }], wpath: [w], rev: 0, lastDir: null };
    if (tool === 'stone') {
      g.ghost = { x: w.x, y: w.y, size: 0, seed: Math.random(), _ghost: true, id: 'ghost' };
      g.lastGrow = now();
      RS.audio.preview(0, { pan: panX(w.x) });
    } else if (tool === 'reed') {
      const h = M.hitWater(V(), w.x, w.y, 46);
      if (h) {
        const P = M.pointAtU(h.st, h.u);
        let side = Math.sign((w.x - P.x) * -P.ty + (w.y - P.y) * P.tx) || 1;
        if (h.st.closed && h.inPond) side = -h.st.inner;
        g.reed = { sid: h.st.id, u0: h.u, a: h.u, b: h.u, side, size: 0, seed: Math.floor(Math.random() * 1e6), id: 'ghost-reed' };
        g.lastGrow = now();
        RS.audio.reedPreview(0, { pan: panX(w.x) });
      }
    } else if (g.hit && g.hit.type === 'stone') {
      RS.audio.preview(g.hit.s.size, { pan: panX(g.hit.s.x) });
      RS.fx.ripple(g.hit.s.x, g.hit.s.y, { r0: 4, r1: 22, a: 0.4, dur: 1 });
      RS.fx.stoneGlow.set(g.hit.s.id, RS.fx.now);
      g.lastGrow = now();
    } else if (g.hit && g.hit.type === 'reed') {
      RS.audio.reedPreview(g.hit.rd.size, { pan: panX(w.x) });
      g.lastGrow = now();
    }
  }
  function onMove(e) {
    hover.x = e.clientX; hover.y = e.clientY; hover.inside = true; hover.type = e.pointerType; hover.t = now();
    const p = ptrs.get(e.pointerId);
    if (!p) { RS.ui.hover(e.clientX, e.clientY); return; }
    const px = p.x, py = p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (g && g.kind === 'two') { moveTwo(); return; }
    if (!g) return;
    if (g.kind === 'ui') { if (Math.hypot(p.x - p.sx, p.y - p.sy) > DRAG) g.moved = true; RS.ui.drag(g.ui, p.x, p.y); return; }
    if (g.kind === 'pan') { R().panBy(p.x - g.lx, p.y - g.ly); g.lx = p.x; g.ly = p.y; return; }
    const w = W(p.x, p.y);
    if (g.kind === 'rub') { rub(w); return; }
    if (g.kind === 'rain') {
      // a slow frame can make a quick drag look like a hold: if the hand clearly set off drawing, draw
      if (now() - g.rainT < 0.35 && Math.hypot(p.x - g.p.sx, p.y - g.p.sy) > 26) {
        RS.rain.cancel();
        g.kind = 'press'; g.moved = true;
        g.path.push({ x: p.x, y: p.y }); g.wpath.push(w);
        beginDrag(w);
        return;
      }
      RS.rain.move(w.x, w.y);
      return;
    }
    if (g.kind === 'press') {
      g.path.push({ x: p.x, y: p.y });
      g.wpath.push(w);
      trackRub(g, p.x - px, p.y - py);
      if (g.kind !== 'press') return;
      if (!g.moved && Math.hypot(p.x - g.p.sx, p.y - g.p.sy) > DRAG) { g.moved = true; beginDrag(w); }
      else if (g.moved) dragMove(w);
      return;
    }
    if (g.kind === 'draw') {
      g.path.push({ x: p.x, y: p.y });
      g.wpath.push(w);
      trackRub(g, p.x - px, p.y - py); // even after a stroke ended on water: a scribble means rub
      if (g.kind === 'draw' && !g.done) extendStroke(w);
      return;
    }
    dragMove(w);
  }
  function onUp(e) {
    const p = ptrs.get(e.pointerId);
    ptrs.delete(e.pointerId);
    if (!p) return;
    if (g && g.kind === 'two') {
      if (ptrs.size < 2) endTwo();
      return;
    }
    if (!g) return;
    const w = W(p.x, p.y);
    const kind = g.kind;
    if (kind === 'ui') RS.ui.release(g.ui, p.x, p.y, g.moved);
    else if (kind === 'rain') RS.rain.stop();
    else if (kind === 'rub') A().commitErase();
    else if (kind === 'press') tap(w);
    else if (kind === 'draw') { if (!g.done) finishStroke(g.frozen ? g.contact : null); }
    else endDrag(w);
    g = null;
  }
  function onCancel(e) {
    ptrs.delete(e.pointerId);
    if (g && g.kind === 'rain') RS.rain.stop();
    if (g && g.kind === 'draw') A().setDraft(null);
    g = null;
  }
  // a quick back-and-forth scribble means "rub it out"
  function trackRub(gg, dx, dy) {
    const L = Math.hypot(dx, dy);
    if (L < 3) return;
    const d = { x: dx / L, y: dy / L };
    if (gg.lastDir && d.x * gg.lastDir.x + d.y * gg.lastDir.y < -0.25) gg.rev = (gg.rev || 0) + 1;
    gg.lastDir = d;
    const age = now() - gg.t0;
    if (gg.rev >= 2 && age < 1.6 && (tool === null) && !(gg.hit && /stone|lantern|twig/.test(gg.hit.type))) {
      const xs = gg.path.map((q) => q.x), ys = gg.path.map((q) => q.y);
      const ext = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      if (ext < 200) {
        A().setDraft(null);
        const wp = gg.wpath || [];
        g = { kind: 'rub', last: wp[0] || W(hover.x, hover.y) };
        for (const q of wp) rub(q);
        RS.hints.did('rub');
      }
    }
  }
  function rub(w, first) {
    const R0 = 12 + 10 / zoom();
    if (g.last && !first) {
      const d = Math.hypot(w.x - g.last.x, w.y - g.last.y);
      const n = Math.ceil(d / (R0 * 0.5));
      for (let i = 1; i <= n; i++) A().eraseAt(U.lerp(g.last.x, w.x, i / n), U.lerp(g.last.y, w.y, i / n), R0);
    } else A().eraseAt(w.x, w.y, R0);
    g.last = w;
  }

  // ---------- press → drag ----------
  function beginDrag(w) {
    const v = V();
    if (tool === 'stone') { g.kind = 'stoneDrag'; return; }
    if (tool === 'reed') { g.kind = g.reed ? 'reedPaint' : 'void'; if (g.reed) dragMove(w); return; }
    if (tool === 'twig' || tool === 'lantern') { g.kind = 'placeDrag'; return; }
    const h = g.hit;
    if (h && h.type === 'stone') { g.kind = 'moveStone'; g.obj = h.s; return; }
    if (h && h.type === 'lantern') { g.kind = 'moveLantern'; g.obj = h.L; return; }
    if (h && h.type === 'twig') { g.kind = 'moveTwig'; g.obj = h.t; return; }
    // draw water: from land, or branching out of existing water
    const start = g.w;
    const hw = M.hitWater(v, start.x, start.y, 2 / zoom());
    g.kind = 'draw';
    g.raw = [];
    if (hw) {
      const st = hw.st;
      let u = M.snapHalf(st, hw.u);
      if (!st.closed && u >= st.U) u = st.U - 0.5;
      const P = M.pointAtU(st, u);
      g.parent = { sid: st.id, u };
      g.raw.push([P.x, P.y]);
    } else g.raw.push([start.x, start.y]);
    for (const q of g.wpath.slice(1)) extendStroke(q);
  }
  function dragMove(w) {
    if (g.kind === 'reedPaint') {
      const st = M.stream(V(), g.reed.sid);
      if (!st) return;
      const nr = M.nearest(st, w.x, w.y);
      let u = nr.u;
      if (st.closed) { // keep the stretch continuous around a pond
        let du = u - g.reed.u0;
        if (du > st.U / 2) du -= st.U; else if (du < -st.U / 2) du += st.U;
        u = g.reed.u0 + du;
      }
      g.reed.a = Math.min(g.reed.u0, u); g.reed.b = Math.max(g.reed.u0, u);
      return;
    }
    if (g.kind === 'stoneDrag' || g.kind === 'placeDrag') { g.cur = w; g.wpath.push(w); return; }
    if (g.kind === 'moveStone' || g.kind === 'moveLantern' || g.kind === 'moveTwig') { g.cur = w; return; }
  }
  function endDrag(w) {
    const v = V();
    const overTray = RS.ui.overTray(hover.x, hover.y);
    switch (g.kind) {
      case 'stoneDrag': classifyStoneDrag(w); break;
      case 'reedPaint': placeReed(); break;
      case 'placeDrag': tapTool(w); break;
      case 'moveStone':
        if (overTray) A().removeStone(g.obj); else A().moveStone(g.obj, w.x, w.y);
        break;
      case 'moveLantern': {
        const h = !overTray && M.hitWater(v, w.x, w.y, 6 / zoom());
        if (h) A().moveLantern(g.obj, h.st.id, M.snapHalf(h.st, h.u)); else A().putOutLantern(g.obj);
        break;
      }
      case 'moveTwig': {
        const h = !overTray && M.hitWater(v, w.x, w.y, 4 / zoom());
        A().liftTwig(g.obj);
        if (h) A().placeTwig(h.st.id, M.snapHalf(h.st, h.u));
        break;
      }
    }
  }
  function tap(w) {
    const v = V();
    if (tool) return tapTool(w);
    const h = g.hit;
    if (!h) return;
    if (h.type === 'twig') { A().liftTwig(h.t); return; }
    if (h.type === 'land' && g.rainStarted) return;
  }
  function tapTool(w) {
    const v = V();
    if (tool === 'stone') { const gh = g.ghost; A().placeStone(gh ? gh.x : w.x, gh ? gh.y : w.y, gh ? gh.size : 0); return; }
    if (tool === 'reed') { if (g.reed) placeReed(); else RS.ui.nope(hover.x, hover.y); return; }
    const h = M.hitWater(v, w.x, w.y, 6 / zoom());
    if (!h) { RS.ui.nope(hover.x, hover.y); return; }
    if (tool === 'twig') A().placeTwig(h.st.id, M.snapHalf(h.st, h.u));
    if (tool === 'lantern') A().placeLantern(h.st.id, M.snapHalf(h.st, h.u));
  }
  function placeReed() {
    const r = g.reed;
    const st = M.stream(V(), r.sid);
    if (!st) return;
    let a = Math.round(r.a * 2) / 2, b = Math.round(r.b * 2) / 2;
    if (b - a < 1) { a = Math.round((r.u0 - 1) * 2) / 2; b = a + 2; }
    if (!st.closed) { a = U.clamp(a, 0, st.U - 1); b = U.clamp(b, a + 1, st.U); }
    else if (b - a > st.U) b = a + st.U;
    A().placeReed({ sid: st.id, a, b, side: r.side, size: r.size });
  }
  // a stone dragged along the water lays gravel; dragged across it, a ledge and a little waterfall
  function classifyStoneDrag(w) {
    const v = V(), path = g.wpath;
    const a = path[0], b = path[path.length - 1];
    const mid = path[Math.floor(path.length / 2)];
    const h = M.hitWater(v, mid.x, mid.y, 18) || M.hitWater(v, a.x, a.y, 18) || M.hitWater(v, b.x, b.y, 18);
    if (h) {
      const st = h.st;
      const unit = st.k * M.V0;
      let minS = 1e9, maxS = -1e9, minU = 1e9, maxU = -1e9, cross = null, prev = null;
      for (const q of path) {
        const nr = M.nearest(st, q.x, q.y);
        const P = M.pointAtU(st, nr.u);
        const s = (q.x - P.x) * -P.ty + (q.y - P.y) * P.tx;
        let u = nr.u;
        if (st.closed && minU < 1e8) { const ref = (minU + maxU) / 2; let du = u - ref; if (du > st.U / 2) u -= st.U; else if (du < -st.U / 2) u += st.U; }
        minS = Math.min(minS, s); maxS = Math.max(maxS, s); minU = Math.min(minU, u); maxU = Math.max(maxU, u);
        if (prev && Math.sign(prev.s) !== Math.sign(s) && cross == null) cross = (prev.u + u) / 2;
        prev = { s, u };
      }
      const hw = M.widthAt(st, h.u) / 2;
      const alongLen = (maxU - minU) * unit;
      if (cross != null && minS < -hw * 0.5 && maxS > hw * 0.5 && alongLen < Math.max(30, hw * 2.6)) {
        let u = M.snapHalf(st, cross);
        if (!st.closed) u = U.clamp(u, 0.5, st.U - 0.5);
        A().placeFall(st.id, u);
        return;
      }
      if (alongLen >= unit * 0.6 && Math.max(Math.abs(minS), Math.abs(maxS)) < hw + 16) {
        let ga = Math.round(minU * 2) / 2, gb = Math.round(maxU * 2) / 2;
        if (gb - ga < 1) gb = ga + 1;
        if (!st.closed) { ga = U.clamp(ga, 0, st.U - 0.5); gb = U.clamp(gb, ga + 0.5, st.U); }
        A().placeGravel(st.id, ga, gb);
        return;
      }
    }
    A().placeStone(b.x, b.y, g.ghost ? g.ghost.size : 0);
  }

  // ---------- drawing water ----------
  function extendStroke(w) {
    if (g.done || g.frozen) return;
    const raw = g.raw;
    const last = raw[raw.length - 1];
    const x = U.clamp(w.x, 6, M.WORLD.w - 6), y = U.clamp(w.y, 6, M.WORLD.h - 6);
    const d = Math.hypot(x - last[0], y - last[1]);
    if (d < 3) return;
    const n = Math.ceil(d / 6);
    for (let i = 1; i <= n; i++) {
      const p = [U.lerp(last[0], x, i / n), U.lerp(last[1], y, i / n)];
      raw.push(p);
      const c = contact(p);
      // touching water ends the stroke; wait a breath first in case the hand is rubbing, not drawing
      if (c) { g.contact = c; g.contactAt = now(); g.frozen = true; updateDraft(); return; }
    }
    updateDraft();
  }
  function rawLen() {
    let L = 0;
    for (let i = 1; i < g.raw.length; i++) L += Math.hypot(g.raw[i][0] - g.raw[i - 1][0], g.raw[i][1] - g.raw[i - 1][1]);
    return L;
  }
  function contact(tip) {
    const v = V(), raw = g.raw;
    const total = rawLen();
    // touching itself: a pond
    if (total > 70) {
      let acc = 0;
      const cum = [0];
      for (let i = 1; i < raw.length; i++) { acc += Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]); cum.push(acc); }
      for (let i = 0; i < raw.length; i++) {
        if (total - cum[i] < 46) break;
        if (Math.hypot(raw[i][0] - tip[0], raw[i][1] - tip[1]) < 12) return { type: 'self', idx: i, nearStart: cum[i] < 30 };
      }
    }
    // touching other water: join it (a branch must leave its parent before it can rejoin it)
    const h = M.hitWater(v, tip[0], tip[1], 1);
    if (g.parent && !g.leftParent && (!h || h.st.id !== g.parent.sid)) {
      const ph = M.stream(v, g.parent.sid);
      const nr = ph && M.nearest(ph, tip[0], tip[1]);
      if (!ph || (nr.d > M.widthAt(ph, nr.u) / 2 + 14 && total > 34)) g.leftParent = true;
    }
    if (h) {
      if (g.parent && h.st.id === g.parent.sid && !g.leftParent) return null;
      return { type: 'stream', sid: h.st.id, u: h.u };
    }
    return null;
  }
  function updateDraft() {
    if (!g || !g.raw || g.raw.length < 2) { A().setDraft(null); return; }
    let pts = U.chaikin(g.raw, 2, false);
    pts = U.resample(pts, M.STEP, false);
    if (pts.length < 2) return;
    A().setDraft(M.makeStream({ id: 'draft', pts, startAttach: g.parent ? { sid: g.parent.sid, u: g.parent.u } : null, seed: 5 }));
  }
  function finishStroke(c) {
    g.done = true;
    A().setDraft(null);
    A().finishStroke(g.raw.slice(), g.parent, c);
  }

  // ---------- two fingers: pinch the water, or zoom and pan ----------
  function startTwo() {
    if (g && g.kind === 'draw' && !g.done) A().setDraft(null);
    if (g && g.kind === 'rain') RS.rain.stop();
    const [a, b] = [...ptrs.values()];
    const wa = W(a.x, a.y), wb = W(b.x, b.y);
    const v = V();
    const ha = M.hitWater(v, wa.x, wa.y, 8 / zoom()), hb = M.hitWater(v, wb.x, wb.y, 8 / zoom());
    const d0 = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
    if (ha && hb && ha.st === hb.st && !tool) {
      g = { kind: 'two', mode: 'water', sid: ha.st.id, ua: ha.u, ub: hb.u, d0, ratio: 1 };
    } else {
      g = { kind: 'two', mode: 'view', d0, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
  }
  function moveTwo() {
    const ps = [...ptrs.values()];
    if (ps.length < 2) return;
    const [a, b] = ps;
    const d = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
    if (g.mode === 'water') { g.ratio = d / g.d0; return; }
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    R().panBy(mx - g.mx, my - g.my);
    R().zoomAt(mx, my, d / g.d0);
    g.d0 = d; g.mx = mx; g.my = my;
    checkAtlasZoom();
  }
  function endTwo() {
    if (g.mode === 'water') {
      const st = M.stream(V(), g.sid);
      if (st && (g.ratio < 0.74 || g.ratio > 1.35)) {
        let a = Math.min(g.ua, g.ub), b = Math.max(g.ua, g.ub);
        if (st.closed && b - a > st.U / 2) { const t = a; a = b; b = t + st.U; }
        let ia = Math.floor(a), ib = Math.ceil(b);
        if (ib - ia < 2) { const m = Math.floor((a + b) / 2); ia = m - 1; ib = m + 1; }
        A().changeSpeed(st, ia, ib, g.ratio > 1 ? 1 : -1);
      }
    }
    g = null;
  }
  function checkAtlasZoom() {
    if (R().cam.tz <= R().fitZoom() * 0.6) { R().showAll(); RS.ui.openAtlas(); }
  }

  // ---------- wheel & keys ----------
  function onWheel(e) {
    if (RS.ui.blocking()) return;
    e.preventDefault();
    const dy = (e.deltaY || e.deltaX) * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    const w = W(e.clientX, e.clientY);
    if (e.shiftKey || e.ctrlKey) {
      const h = M.hitWater(V(), w.x, w.y, 6 / zoom());
      if (h) {
        if (wheelSid !== h.st.id || now() - wheelT > 0.6) wheelAcc = 0;
        wheelSid = h.st.id; wheelT = now();
        wheelAcc += dy;
        const step = e.ctrlKey ? 24 : 70;
        if (Math.abs(wheelAcc) >= step) {
          A().changeSpeedAt(h.st, h.u, wheelAcc < 0 ? 1 : -1);
          wheelAcc = 0;
        }
        return;
      }
    }
    R().zoomAt(e.clientX, e.clientY, Math.exp(-dy * 0.0016));
    checkAtlasZoom();
  }
  function onKey(e, down) {
    if (RS.ui.typing()) return;
    if (e.key === ' ') { space = down; if (down) e.preventDefault(); return; }
    if (!down) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') { if (RS.ui.closeOverlays()) return; dropTool(); return; }
    if (RS.ui.blocking()) return;
    if (k === 'm') { A().toggleMute(); return; }
    if (k === 'h' || k === '?') { RS.ui.toggleHelp(); return; }
    if (k === '0') { R().showAll(); return; }
    if (e.key === 'Home') { R().home(); return; }
    if (k === '+' || k === '=') { R().zoomAt(R().cssW / 2, R().cssH / 2, 1.25); return; }
    if (k === '-' || k === '_') { R().zoomAt(R().cssW / 2, R().cssH / 2, 0.8); checkAtlasZoom(); return; }
    const pan = 70;
    if (k === 'arrowleft') R().panBy(pan, 0);
    else if (k === 'arrowright') R().panBy(-pan, 0);
    else if (k === 'arrowup') R().panBy(0, pan);
    else if (k === 'arrowdown') R().panBy(0, -pan);
    else if (k === '1') setTool('stone');
    else if (k === '2') setTool('reed');
    else if (k === '3') setTool('twig');
    else if (k === '4') setTool('lantern');
    else if (k === 'a') RS.ui.openAtlas();
  }

  // ---------- holding still: things grow; on bare land, rain ----------
  function update() {
    if (!g) return;
    const t = now();
    if (g.kind === 'draw' && g.frozen && !g.done && t - g.contactAt > 0.4) { finishStroke(g.contact); return; }
    if (g.kind === 'press' && !g.moved) {
      const held = t - g.t0;
      if (tool === 'stone' && g.ghost) {
        const step = held < 1.2 ? 0.25 : 0.16;
        if (held > 0.32 && t - g.lastGrow > step) {
          g.lastGrow = t;
          g.ghost.size = (g.ghost.size + 1) % MU.STONE_SIZES;
          g.ghost._grow = RS.fx.now;
          RS.audio.preview(g.ghost.size, { pan: panX(g.ghost.x) });
        }
      } else if (tool === 'reed' && g.reed) {
        if (held > 0.35 && t - g.lastGrow > 0.3) {
          g.lastGrow = t;
          g.reed.size = (g.reed.size + 1) % MU.REED_SIZES;
          RS.audio.reedPreview(g.reed.size, { pan: panX(g.w.x) });
        }
      } else if (!tool && g.hit && g.hit.type === 'stone') {
        if (held > 0.38 && t - g.lastGrow > 0.24) {
          g.lastGrow = t;
          A().resizeStone(g.hit.s, (g.hit.s.size + 1) % MU.STONE_SIZES);
        }
      } else if (!tool && g.hit && g.hit.type === 'reed') {
        if (held > 0.45 && t - g.lastGrow > 0.32) {
          g.lastGrow = t;
          A().resizeReed(g.hit.rd, (g.hit.rd.size + 1) % MU.REED_SIZES);
        }
      } else if (!tool && g.hit && g.hit.type === 'land' && held > 0.45) {
        g.kind = 'rain';
        g.rainT = t;
        RS.rain.start(g.w.x, g.w.y);
        RS.hints.did('rain');
      }
    }
  }

  // ---------- previews drawn into the sprite batches ----------
  function previews(bt, tSec, sky) {
    if (!g) return;
    const v = V();
    if (g.ghost && (g.kind === 'press' || g.kind === 'stoneDrag')) {
      const s = g.ghost;
      let x = s.x, y = s.y;
      if (g.kind === 'stoneDrag' && g.cur) { x = g.cur.x; y = g.cur.y; }
      const r = MU.stoneRadius(s.size) * (s._grow ? 1 + 0.2 * Math.exp(-(tSec - s._grow) * 8) : 1);
      bt.obj.add(x, y, r, r, s.seed * 6.28, 0, s.seed, 0.3, 0, 0, 1, 1, 1, 0.8);
      const st = A().settleTarget(x, y, s.size);
      if (st) bt.over.add(st.x, st.y, r + 3, r + 3, 0, 7, 0.12, 0, 0, 0, 1, 1, 1, 0.45);
      if (g.kind === 'stoneDrag' && g.wpath.length > 1) {
        for (let i = 0; i < g.wpath.length; i += 2) { const q = g.wpath[i]; bt.over.add(q.x, q.y, 1.6, 1.6, 0, 6, 1.5, 0, 0, 0, 0.95, 0.92, 0.85, 0.5); }
      }
    }
    if (g.reed && (g.kind === 'press' || g.kind === 'reedPaint')) {
      const tmp = Object.assign({}, g.reed);
      if (tmp.b - tmp.a < 0.5) { tmp.a = g.reed.u0 - 0.5; tmp.b = g.reed.u0 + 0.5; }
      const st = M.stream(v, tmp.sid);
      if (st) {
        tmp._key = null;
        for (const b of RS.scene.blades(v, tmp)) {
          const cx = b.bx + Math.cos(b.ang) * b.L * 0.5, cy = b.by + Math.sin(b.ang) * b.L * 0.5;
          bt.obj.add(cx, cy, b.L * 0.5, b.head ? b.w * 2.2 : b.w, b.ang, 1, b.ph, 0.4, b.head ? 1 : 0, b.head ? 0.45 : 1, b.c[0], b.c[1], b.c[2], 0.75);
        }
      }
    }
    if ((g.kind === 'moveStone') && g.cur) {
      const s = g.obj, r = MU.stoneRadius(s.size);
      bt.obj.add(g.cur.x, g.cur.y, r, r, s.seed * 6.28, 0, s.seed, 0.4, 0, 0, 1, 1, 1, 0.75);
    }
    if (g.kind === 'moveLantern' && g.cur) bt.obj.add(g.cur.x, g.cur.y, 7, 7, 0, 3, 0, 0.6, 0, 0, 1, 1, 1, 0.8);
    if (g.kind === 'moveTwig' && g.cur) bt.obj.add(g.cur.x, g.cur.y, 16, 5, 0.3, 2, g.obj.seed, 0, 0, 0, 1, 1, 1, 0.8);
    if (g.kind === 'two' && g.mode === 'water') {
      const st = M.stream(v, g.sid);
      if (st) {
        const a = Math.min(g.ua, g.ub), b = Math.max(g.ua, g.ub);
        const steps = Math.max(4, Math.round((b - a) * 4));
        for (let i = 0; i <= steps; i++) {
          const u = a + ((b - a) * i) / steps, P = M.pointAtU(st, u), hw = (M.widthAt(st, u) / 2) * U.clamp(g.ratio, 0.4, 2.2);
          for (const sd of [-1, 1]) bt.over.add(P.x - P.ty * hw * sd, P.y + P.tx * hw * sd, 2, 2, 0, 6, 1.4, 0, 0, 0, 1, 1, 1, 0.7);
        }
      }
    }
  }
  const panX = (x) => U.clamp((x - R().cam.x) * R().cam.zoom / (R().cssW / 2), -1, 1) * 0.7;

  function attach(cv) {
    canvas = cv;
    cv.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => onKey(e, true));
    window.addEventListener('keyup', (e) => onKey(e, false));
    window.addEventListener('blur', () => { space = false; });
    cv.addEventListener('pointerleave', () => { hover.inside = false; });
  }
  return {
    attach, update, previews, setTool, dropTool, panX,
    get tool() { return tool; },
    get gesture() { return g; },
    get hover() { return hover; },
    get pointers() { return ptrs.size; },
  };
})();
