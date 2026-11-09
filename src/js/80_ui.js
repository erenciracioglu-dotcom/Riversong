/* Riversong — the only controls: a little tray of things you can pick up, the light, and a few quiet words. */
'use strict';
RS.ui = (() => {
  const U = RS.util;
  let cv, ctx, dpr = 1, Wc = 1, Hc = 1;
  let tool = null;
  let trayA = 1, trayLast = performance.now() + 4500;
  let sunDrag = false, sunHover = 0, sunLabelT = -10;
  const nopes = [];
  let toast = null;
  let listenA = 0;
  let loading = { on: true, p: 0 };
  const TOOLS = ['stone', 'reed', 'twig', 'lantern'];
  const SMALL = ['atlas', 'help'];
  let slots = [];
  let isTouch = false;
  const tr = () => RS.i18n.t();

  function init(canvas) {
    cv = canvas;
    ctx = cv.getContext('2d');
    resize();
    window.matchMedia && (isTouch = window.matchMedia('(pointer: coarse)').matches);
    RS.i18n.onChange(() => { buildHelp(); if (atlasOpen()) RS.atlas.render(); });
    buildHelp();
  }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    Wc = window.innerWidth; Hc = window.innerHeight;
    cv.width = Math.round(Wc * dpr); cv.height = Math.round(Hc * dpr);
    layout();
  }
  function layout() {
    const s = Wc < 520 ? 0.82 : 1;
    const big = 58 * s, small = 40 * s, gap = 6 * s, pad = 12 * s;
    const total = TOOLS.length * big + SMALL.length * small + (TOOLS.length + SMALL.length - 1) * gap + 14 * s + pad * 2;
    let x = Wc / 2 - total / 2 + pad;
    const y = Hc - 16 * s - big / 2 - pad;
    slots = [];
    for (const t of TOOLS) { slots.push({ id: t, x: x + big / 2, y, w: big, h: big, tool: true }); x += big + gap; }
    x += 14 * s;
    for (const t of SMALL) { slots.push({ id: t, x: x + small / 2, y: y + (big - small) / 2, w: small, h: small }); x += small + gap; }
    UI.tray = { x0: Wc / 2 - total / 2, x1: Wc / 2 + total / 2, y0: y - big / 2 - pad, y1: y + big / 2 + pad, s };
    const r = Math.min(64, Wc * 0.12);
    UI.sun = { cx: Wc - r - 30, cy: r + 34, r };
  }
  const UI = { tray: null, sun: null };

  // ---------- light handle ----------
  const sunAngle = (tod) => Math.PI * 1.06 + tod * Math.PI * 0.88;
  function sunPos(tod) { const a = sunAngle(tod), s = UI.sun; return { x: s.cx + Math.cos(a) * s.r, y: s.cy + Math.sin(a) * s.r }; }
  function todFromPoint(x, y) {
    const s = UI.sun;
    let a = Math.atan2(y - s.cy, x - s.cx);
    if (a < 0) a += Math.PI * 2;
    if (a < Math.PI * 0.5) a += Math.PI * 2;
    return U.clamp((a - Math.PI * 1.06) / (Math.PI * 0.88), 0, 1);
  }

  // ---------- hit testing & pointer hooks (called by input) ----------
  function hit(x, y) {
    if (overTray(x, y) && trayA > 0.05) {
      for (const s of slots) if (Math.abs(x - s.x) < s.w / 2 + 3 && Math.abs(y - s.y) < s.h / 2 + 3) return { type: 'slot', id: s.id };
      return { type: 'tray' };
    }
    const V = RS.app.valley;
    if (V) {
      const p = sunPos(V.tod);
      if (Math.hypot(x - p.x, y - p.y) < 26) return { type: 'sun' };
    }
    return null;
  }
  function overTray(x, y) { const t = UI.tray; return t && x > t.x0 - 10 && x < t.x1 + 10 && y > t.y0 - 10 && y < t.y1 + 12; }
  function press(ui, x, y) {
    trayLast = performance.now();
    if (ui.type === 'sun') { sunDrag = true; sunLabelT = performance.now(); }
  }
  function drag(ui, x, y) {
    if (ui.type === 'sun') { RS.app.setTod(todFromPoint(x, y)); sunLabelT = performance.now(); }
  }
  function release(ui, x, y, moved) {
    trayLast = performance.now();
    if (ui.type === 'sun') { sunDrag = false; RS.hints.did('light'); return; }
    if (ui.type !== 'slot') return;
    if (moved && !overTray(x, y) && TOOLS.includes(ui.id)) {
      // dragged a thing out of the tray and let go over the valley: place it there
      RS.input.setTool(ui.id);
      RS.app.placeFromTray(ui.id, x, y);
      return;
    }
    if (ui.id === 'atlas') { openAtlas(); return; }
    if (ui.id === 'help') { toggleHelp(); return; }
    RS.input.setTool(ui.id);
  }
  function hover(x, y) { /* hover handled in draw via RS.input.hover */ }
  function toolChanged(t) { tool = t; trayLast = performance.now(); }
  function nope(x, y) { nopes.push({ x, y, t0: performance.now() }); }
  function showToast(text, ms = 2200) { toast = { text, t0: performance.now(), ms }; }
  function setLoading(on, p) { loading.on = on; if (p != null) loading.p = p; }

  // ---------- drawing the tray items as themselves ----------
  function stoneIcon(x, y, r, a = 1) {
    ctx.save(); ctx.globalAlpha *= a;
    ctx.fillStyle = 'rgba(30,25,15,0.25)';
    ctx.beginPath(); ctx.ellipse(x + r * 0.18, y + r * 0.22, r * 1.02, r * 0.86, 0, 0, 6.283); ctx.fill();
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r * 1.1);
    g.addColorStop(0, '#d9d4cb'); g.addColorStop(0.55, '#9b958b'); g.addColorStop(1, '#5d5850');
    ctx.fillStyle = g;
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) { const t = (i / 24) * 6.283; const rr = r * (1 + 0.07 * Math.sin(3 * t + 1) + 0.04 * Math.sin(5 * t)); ctx.lineTo(x + Math.cos(t) * rr, y + Math.sin(t) * rr * 0.86); }
    ctx.fill();
    ctx.restore();
  }
  function reedIcon(x, y, s, a = 1) {
    ctx.save(); ctx.globalAlpha *= a; ctx.lineCap = 'round';
    const blades = [[-0.5, -1.05, '#5f8a3a'], [0.05, -1.25, '#4f7a30'], [0.55, -0.95, '#6f9a44'], [-0.15, -1.1, '#58823a']];
    for (const [dx, h, c] of blades) {
      ctx.strokeStyle = c; ctx.lineWidth = 2.6 * s / 20;
      ctx.beginPath(); ctx.moveTo(x + dx * 4 * s / 20, y + 0.85 * s); ctx.quadraticCurveTo(x + dx * s * 0.6, y, x + dx * s * 0.9, y + h * s * 0.8); ctx.stroke();
    }
    ctx.fillStyle = '#6b4526';
    ctx.beginPath(); ctx.ellipse(x + 0.05 * s, y - 0.55 * s, 0.13 * s, 0.32 * s, 0.05, 0, 6.283); ctx.fill();
    ctx.restore();
  }
  function twigIcon(x, y, s, a = 1) {
    ctx.save(); ctx.globalAlpha *= a; ctx.lineCap = 'round'; ctx.strokeStyle = '#6e4c2c';
    ctx.lineWidth = s * 0.16;
    ctx.beginPath(); ctx.moveTo(x - s * 0.95, y + s * 0.35); ctx.quadraticCurveTo(x, y - s * 0.05, x + s * 0.95, y - s * 0.35); ctx.stroke();
    ctx.lineWidth = s * 0.08;
    ctx.beginPath(); ctx.moveTo(x - s * 0.15, y + s * 0.12); ctx.lineTo(x - s * 0.35, y - s * 0.45); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + s * 0.35, y - s * 0.12); ctx.lineTo(x + s * 0.6, y + s * 0.3); ctx.stroke();
    ctx.fillStyle = '#7da04a';
    ctx.beginPath(); ctx.ellipse(x - s * 0.4, y - s * 0.52, s * 0.14, s * 0.07, -0.9, 0, 6.283); ctx.fill();
    ctx.restore();
  }
  function lanternIcon(x, y, s, a = 1, t = 0) {
    ctx.save(); ctx.globalAlpha *= a;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, s * 1.4);
    glow.addColorStop(0, 'rgba(255,200,110,0.55)'); glow.addColorStop(1, 'rgba(255,170,80,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, s * 1.4, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#5a3d22';
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - s * 0.72, y - s * 0.72, s * 1.44, s * 1.44, s * 0.25) : ctx.rect(x - s * 0.72, y - s * 0.72, s * 1.44, s * 1.44); ctx.fill();
    const g = ctx.createRadialGradient(x, y, s * 0.05, x, y, s * 0.62);
    g.addColorStop(0, '#fff6d8'); g.addColorStop(0.35, '#ffd27a'); g.addColorStop(1, '#e98a36');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, s * 0.6, 0, 6.283); ctx.fill();
    ctx.strokeStyle = 'rgba(150,70,20,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, s * 0.36, 0, 6.283); ctx.stroke();
    ctx.restore();
  }
  function atlasIcon(x, y, s, a = 1) {
    ctx.save(); ctx.globalAlpha *= a;
    const w = s * 0.9, h = s * 0.62;
    const xs = [x - w, x - w / 3, x + w / 3, x + w];
    const fills = ['#efe3c4', '#e2d3ae', '#efe3c4'];
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = fills[i];
      ctx.beginPath(); ctx.moveTo(xs[i], y - h + (i % 2 ? 3 : 0)); ctx.lineTo(xs[i + 1], y - h + (i % 2 ? 0 : 3)); ctx.lineTo(xs[i + 1], y + h + (i % 2 ? 0 : 3)); ctx.lineTo(xs[i], y + h + (i % 2 ? 3 : 0)); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = '#4a7fa3'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - w * 0.85, y + h * 0.4); ctx.bezierCurveTo(x - w * 0.3, y - h * 0.6, x + w * 0.2, y + h * 0.7, x + w * 0.85, y - h * 0.35); ctx.stroke();
    ctx.restore();
  }
  function helpIcon(x, y, s, a = 1) {
    ctx.save(); ctx.globalAlpha *= a;
    ctx.fillStyle = '#f2ead8'; ctx.beginPath(); ctx.arc(x, y, s * 0.72, 0, 6.283); ctx.fill();
    ctx.strokeStyle = 'rgba(90,70,40,0.4)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#6a5233'; ctx.font = `italic ${Math.round(s * 0.95)}px Georgia, 'Times New Roman', serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('?', x, y + 1);
    ctx.restore();
  }
  function icon(id, x, y, s, a, t) {
    if (id === 'stone') stoneIcon(x, y, s * 0.55, a);
    else if (id === 'reed') reedIcon(x, y + s * 0.15, s * 0.75, a);
    else if (id === 'twig') twigIcon(x, y, s * 0.72, a);
    else if (id === 'lantern') lanternIcon(x, y, s * 0.55, a, t);
    else if (id === 'atlas') atlasIcon(x, y, s * 0.62, a);
    else if (id === 'help') helpIcon(x, y, s * 0.62, a);
  }

  // ---------- per-frame drawing ----------
  function draw(dt, tSec) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, Wc, Hc);
    const V = RS.app.valley;
    const inp = RS.input;
    const hv = inp.hover;
    const nowMs = performance.now();
    // tray fades when you are not reaching for it
    const t = UI.tray;
    const near = hv.inside && hv.x > t.x0 - 140 && hv.x < t.x1 + 140 && hv.y > t.y0 - 150;
    const want = near || tool || nowMs - trayLast < 2600 || (inp.gesture && inp.gesture.kind === 'ui') ? 1 : isTouch ? 0.42 : 0.13;
    trayA += (want - trayA) * (1 - Math.exp(-dt * (want > trayA ? 10 : 2.2)));
    if (V && trayA > 0.01) {
      ctx.save();
      ctx.globalAlpha = trayA;
      const r = 16 * t.s;
      ctx.shadowColor = 'rgba(30,25,10,0.28)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4;
      const grd = ctx.createLinearGradient(0, t.y0, 0, t.y1);
      grd.addColorStop(0, 'rgba(246,238,220,0.86)'); grd.addColorStop(1, 'rgba(226,212,182,0.86)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(t.x0, t.y0, t.x1 - t.x0, t.y1 - t.y0, r) : ctx.rect(t.x0, t.y0, t.x1 - t.x0, t.y1 - t.y0); ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = 'rgba(120,95,60,0.25)'; ctx.lineWidth = 1; ctx.stroke();
      let hoverId = null;
      for (const s of slots) {
        const hov = hv.inside && Math.abs(hv.x - s.x) < s.w / 2 && Math.abs(hv.y - s.y) < s.h / 2;
        if (hov) hoverId = s.id;
        const sel = tool === s.id;
        if (sel || hov) {
          ctx.fillStyle = sel ? 'rgba(255,214,140,0.45)' : 'rgba(255,255,255,0.35)';
          ctx.beginPath(); ctx.arc(s.x, s.y, s.w * 0.46, 0, 6.283); ctx.fill();
        }
        const lift = sel ? -3 : hov ? -1.5 : 0;
        icon(s.id, s.x, s.y + lift, s.w * (s.tool ? 0.62 : 0.72), sel ? 0.55 : 1, tSec);
      }
      if (hoverId && !tool) {
        const s = slots.find((x) => x.id === hoverId);
        const label = tr().tools[hoverId];
        const tip = s.tool ? tr().toolTips[hoverId] : '';
        ctx.globalAlpha = trayA;
        ctx.font = `15px Georgia, 'Times New Roman', serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        textShadow(label, s.x, t.y0 - 26, '#fffaf0');
        if (tip) { ctx.font = `12.5px Georgia, serif`; wrapText(tip, s.x, t.y0 - 8, 300, '#fffaf0'); }
      }
      ctx.restore();
    }
    // the light
    if (V) {
      const S = UI.sun;
      const p = sunPos(V.tod);
      const nearSun = hv.inside && Math.hypot(hv.x - S.cx, hv.y - S.cy) < S.r + 50;
      sunHover += ((nearSun || sunDrag ? 1 : 0) - sunHover) * (1 - Math.exp(-dt * 6));
      ctx.save();
      ctx.globalAlpha = 0.25 + sunHover * 0.55;
      const grad = ctx.createLinearGradient(S.cx - S.r, 0, S.cx + S.r, 0);
      grad.addColorStop(0, 'rgba(255,190,200,0.9)'); grad.addColorStop(0.4, 'rgba(255,250,225,0.9)');
      grad.addColorStop(0.7, 'rgba(255,170,90,0.9)'); grad.addColorStop(1, 'rgba(120,140,220,0.9)');
      ctx.strokeStyle = grad; ctx.lineWidth = 2; ctx.setLineDash([2, 5]);
      ctx.beginPath(); ctx.arc(S.cx, S.cy, S.r, sunAngle(0), sunAngle(1)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      const night = U.smooth(U.clamp((V.tod - 0.7) / 0.12, 0, 1));
      ctx.save();
      const gl = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 30);
      gl.addColorStop(0, night > 0.5 ? 'rgba(200,215,255,0.55)' : 'rgba(255,236,170,0.75)');
      gl.addColorStop(1, 'rgba(255,220,150,0)');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(p.x, p.y, 30, 0, 6.283); ctx.fill();
      ctx.fillStyle = night > 0.5 ? '#e6ecff' : (V.tod < 0.12 ? '#ffd6c4' : V.tod > 0.55 ? '#ffc070' : '#fff3c9');
      ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, 6.283); ctx.fill();
      if (night > 0.02) {
        ctx.globalAlpha = night;
        ctx.fillStyle = 'rgba(40,52,95,0.9)';
        ctx.beginPath(); ctx.arc(p.x + 5, p.y - 3, 9.5, 0, 6.283); ctx.fill();
      }
      ctx.restore();
      if (nowMs - sunLabelT < 1600 || sunDrag) {
        const m = RS.music.modeAt(V.tod);
        ctx.save();
        ctx.globalAlpha = sunDrag ? 1 : U.clamp(1 - (nowMs - sunLabelT - 900) / 700, 0, 1);
        ctx.font = `italic 15px Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        textShadow(tr().times[m], S.cx, S.cy + 16, '#fffaf0');
        ctx.restore();
      }
    }
    // held tool follows a mouse
    const gk = inp.gesture && inp.gesture.kind;
    if (tool && hv.inside && hv.type === 'mouse' && !overTray(hv.x, hv.y) && gk !== 'reedPaint') {
      icon(tool, hv.x + 18, hv.y + 18, 30, 0.85, tSec);
    }
    // the eraser
    if (gk === 'rub') {
      const R0 = (12 + 10 / RS.render.cam.zoom) * RS.render.cam.zoom;
      ctx.save(); ctx.strokeStyle = 'rgba(255,250,235,0.7)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.arc(hv.x, hv.y, R0, 0, 6.283); ctx.stroke(); ctx.restore();
    }
    // little "can't put that here"
    for (let i = nopes.length - 1; i >= 0; i--) {
      const n = nopes[i], k = (nowMs - n.t0) / 700;
      if (k > 1) { nopes.splice(i, 1); continue; }
      ctx.save(); ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#fff3e0'; ctx.lineWidth = 2;
      const r = 8 + k * 10, sx = Math.sin(k * 30) * 3 * (1 - k);
      ctx.beginPath(); ctx.arc(n.x + sx, n.y, r, 0, 6.283); ctx.stroke();
      ctx.restore();
    }
    // quiet words
    RS.hints.draw(ctx, Wc, Hc, UI.tray, dt);
    if (V && RS.audio.ready && !RS.audio.running && !loading.on) {
      listenA = Math.min(1, listenA + dt * 1.5);
    } else listenA = Math.max(0, listenA - dt * 3);
    if (listenA > 0.01) {
      ctx.save();
      ctx.globalAlpha = listenA * (0.75 + 0.25 * Math.sin(tSec * 2.2));
      ctx.font = `italic ${Wc < 520 ? 19 : 23}px Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      textShadow(tr().listen, Wc / 2, Hc * 0.42, '#fffaf0', 10);
      ctx.restore();
    }
    if (loading.on) {
      ctx.save();
      ctx.font = `italic 17px Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      textShadow(tr().loading, Wc / 2, Hc * 0.42, '#fffaf0', 8);
      ctx.fillStyle = 'rgba(255,250,240,0.25)'; ctx.fillRect(Wc / 2 - 80, Hc * 0.42 + 20, 160, 3);
      ctx.fillStyle = 'rgba(255,250,240,0.85)'; ctx.fillRect(Wc / 2 - 80, Hc * 0.42 + 20, 160 * loading.p, 3);
      ctx.restore();
    }
    if (toast) {
      const k = (nowMs - toast.t0) / toast.ms;
      if (k > 1) toast = null;
      else {
        ctx.save(); ctx.globalAlpha = Math.min(1, Math.min(k * 6, (1 - k) * 4));
        ctx.font = `15px Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        textShadow(toast.text, Wc / 2, 34, '#fffaf0', 8);
        ctx.restore();
      }
    }
  }
  function textShadow(text, x, y, col, blur = 6) {
    ctx.save();
    ctx.shadowColor = 'rgba(20,24,18,0.75)'; ctx.shadowBlur = blur;
    ctx.fillStyle = col;
    ctx.fillText(text, x, y);
    ctx.restore();
  }
  function wrapText(text, x, yBottom, maxW, col) {
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    }
    if (line) lines.push(line);
    const lh = 16;
    lines.reverse().forEach((l, i) => textShadow(l, x, yBottom - i * lh, col));
  }

  // ---------- help note & atlas (HTML overlays) ----------
  const $ = (id) => document.getElementById(id);
  function buildHelp() {
    const el = $('help');
    if (!el) return;
    const T = tr();
    el.innerHTML = `<div class="note"><h2>Riversong</h2><dl>${T.help.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl>
      <div class="row"><button data-act="lang">${T.lang}</button><button data-act="mute">${RS.audio.muted ? T.unmuted : T.muted}</button><button data-act="close">${T.close}</button></div>
      <p class="credits">${T.credits}</p></div>`;
    el.onclick = (e) => {
      const act = e.target.getAttribute && e.target.getAttribute('data-act');
      if (act === 'lang') RS.i18n.toggle();
      else if (act === 'mute') { RS.app.toggleMute(); buildHelp(); }
      else if (act === 'close' || e.target === el) toggleHelp(false);
    };
  }
  function toggleHelp(force) {
    const el = $('help');
    const open = force != null ? force : !el.classList.contains('open');
    if (open) buildHelp();
    el.classList.toggle('open', open);
    if (open) RS.hints.did('help');
  }
  const atlasOpen = () => $('atlas') && $('atlas').classList.contains('open');
  function openAtlas() { RS.atlas.open(); RS.hints.did('zoom'); }
  function blocking() { return atlasOpen() || ($('help') && $('help').classList.contains('open')); }
  function closeOverlays() {
    if ($('help').classList.contains('open')) { toggleHelp(false); return true; }
    if (atlasOpen()) { RS.atlas.close(); return true; }
    return false;
  }
  function typing() { const a = document.activeElement; return a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); }

  return {
    init, resize, draw, hit, overTray, press, drag, release, hover, toolChanged, nope, showToast, setLoading,
    toggleHelp, openAtlas, blocking, closeOverlays, typing, icon,
    get ctx() { return ctx; },
  };
})();

// ---------- gentle first-time hints ----------
RS.hints = (() => {
  const ORDER = ['draw', 'pond', 'stone', 'more', 'light', 'twig', 'zoom'];
  const MAP = { draw: 'draw', pond: 'pond', stone: 'stone', reed: 'more', speed: 'more', light: 'light', twig: 'twig', lift: 'lift', zoom: 'zoom', atlas: 'zoom' };
  let done = new Set();
  try { done = new Set(JSON.parse(localStorage.getItem('riversong.hints') || '[]')); } catch (e) { /* fresh */ }
  let cur = null, a = 0, shownAt = 0, nextAt = 3, extra = null;
  const save = () => { try { localStorage.setItem('riversong.hints', JSON.stringify([...done])); } catch (e) { /* ignore */ } };
  function did(action) {
    const k = MAP[action];
    if (!k || done.has(k)) return;
    done.add(k); save();
    if (cur === k) { cur = null; nextAt = performance.now() / 1000 + 3; }
  }
  function want(key) { if (!done.has(key)) extra = key; }
  function draw(ctx, W, H, tray, dt) {
    const t = performance.now() / 1000;
    if (!RS.app.valley || !RS.audio.running) { a = Math.max(0, a - dt * 2); }
    if (!cur && t > nextAt && RS.audio.running) {
      cur = extra && !done.has(extra) ? extra : ORDER.find((k) => !done.has(k)) || null;
      extra = null;
      shownAt = t;
    }
    if (cur) {
      const age = t - shownAt;
      if (age > 13) { cur = null; nextAt = t + 22; }
    }
    const target = cur && RS.audio.running && !RS.ui.blocking() ? 1 : 0;
    a += (target - a) * (1 - Math.exp(-dt * 3));
    if (a < 0.01 || !cur) return;
    const text = RS.i18n.t().hints[cur];
    if (!text) return;
    ctx.save();
    ctx.globalAlpha = a * 0.92;
    ctx.font = `italic ${W < 520 ? 15 : 17}px Georgia, serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.shadowColor = 'rgba(20,24,18,0.8)'; ctx.shadowBlur = 8;
    ctx.fillStyle = '#fffaf0';
    ctx.fillText(text, W / 2, tray.y0 - 52);
    ctx.restore();
  }
  return { did, want, draw, isDone: (k) => done.has(k) };
})();
