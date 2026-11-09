/* Riversong — WebGL2 renderer: camera, cached painted land, water meshes, sprite batches, light & colour. */
'use strict';
RS.render = (() => {
  const M = RS.model, U = RS.util, S = RS.shaders;
  let gl = null, canvas = null;
  let W = 1, H = 1, dpr = 1;           // drawing buffer px, device pixel ratio used
  const P = {};                        // programs
  let sceneFB = null, landFB = null, thumbFB = null;
  let landKey = '';
  let emptyVAO = null;
  const meshes = new Map();            // sid -> mesh
  let draftMesh = null;
  const cam = { x: 1000, y: 625, zoom: 1, tx: 1000, ty: 625, tz: 1 };
  let valley = null;
  let needHome = false;   // the page was laid out at zero size: frame the valley once it has a real size

  // ---------- GL helpers ----------
  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      console.error(log, src.split('\n').map((l, i) => i + 1 + ': ' + l).join('\n'));
      throw new Error('shader compile failed: ' + log);
    }
    return s;
  }
  function program(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link failed: ' + gl.getProgramInfoLog(p));
    const uni = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      uni[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
    }
    return { p, u: uni };
  }
  function makeFB(w, h, withStencil) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    let rb = null;
    if (withStencil) {
      rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, rb);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, tex, rb, w, h };
  }
  function freeFB(f) { if (!f) return; gl.deleteFramebuffer(f.fb); gl.deleteTexture(f.tex); if (f.rb) gl.deleteRenderbuffer(f.rb); }
  const set = (prog, name, ...v) => {
    const loc = prog.u[name];
    if (loc == null) return;
    if (v.length === 1) gl.uniform1f(loc, v[0]);
    else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
    else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]);
    else gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
  };

  // ---------- sprite batches ----------
  const FL = 14;
  function Batch(cap = 2048) { this.data = new Float32Array(cap * FL); this.n = 0; }
  Batch.prototype.clear = function () { this.n = 0; };
  Batch.prototype.add = function (x, y, hx, hy, rot, kind, p0, p1, p2, p3, r, g, b, a) {
    if ((this.n + 1) * FL > this.data.length) { const d = new Float32Array(this.data.length * 2); d.set(this.data); this.data = d; }
    const d = this.data, o = this.n * FL;
    d[o] = x; d[o + 1] = y; d[o + 2] = hx; d[o + 3] = hy; d[o + 4] = rot; d[o + 5] = kind;
    d[o + 6] = p0; d[o + 7] = p1; d[o + 8] = p2; d[o + 9] = p3;
    d[o + 10] = r; d[o + 11] = g; d[o + 12] = b; d[o + 13] = a;
    this.n++;
  };
  const batches = { ripple: new Batch(), shadow: new Batch(), under: new Batch(), obj: new Batch(), over: new Batch(), glow: new Batch() };
  let spriteVAO = null, spriteVBO = null;
  function drawBatch(b, cm) {
    if (!b.n) return;
    gl.useProgram(P.sprite.p);
    set(P.sprite, 'uCam', cm.x, cm.y, cm.sx, cm.sy);
    gl.bindVertexArray(spriteVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, spriteVBO);
    gl.bufferData(gl.ARRAY_BUFFER, b.data.subarray(0, b.n * FL), gl.STREAM_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, b.n);
    gl.bindVertexArray(null);
  }

  // ---------- water meshes ----------
  function stripData(st) {
    const pts = st.pts, n = pts.length, closed = st.closed;
    const count = closed ? n + 1 : n;
    const data = new Float32Array(count * 2 * 9);
    let o = 0;
    for (let j = 0; j < count; j++) {
      const i = j % n, p = pts[i];
      const a = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)];
      const b = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1];
      const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
      const s = j === n ? st.len : st.cum[i];
      const u = s / (st.k * M.V0);
      const t = M.timeAt(st, Math.min(u, st.U));
      const sp = M.speedAt(st, Math.min(u, st.U - 1e-6));
      const hw = M.widthAt(st, u) / 2;
      for (const side of [-1, 1]) {
        data[o++] = p[0]; data[o++] = p[1]; data[o++] = -ty; data[o++] = tx; data[o++] = hw;
        data[o++] = side; data[o++] = u; data[o++] = t; data[o++] = sp;
      }
    }
    return { data, verts: count * 2 };
  }
  function makeVAO(data, layout) {
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    let off = 0;
    const stride = layout.reduce((s, x) => s + x, 0) * 4;
    layout.forEach((sz, i) => { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, sz, gl.FLOAT, false, stride, off); off += sz * 4; });
    gl.bindVertexArray(null);
    return { vao, vbo };
  }
  function freeMesh(m) {
    if (!m) return;
    gl.deleteVertexArray(m.strip.vao); gl.deleteBuffer(m.strip.vbo);
    if (m.fan) { gl.deleteVertexArray(m.fan.vao); gl.deleteBuffer(m.fan.vbo); gl.deleteVertexArray(m.quad.vao); gl.deleteBuffer(m.quad.vbo); }
  }
  function buildMesh(st) {
    const sd = stripData(st);
    const m = { ver: st.ver, strip: makeVAO(sd.data, [2, 2, 1, 1, 1, 1, 1]), n: sd.verts, st };
    if (st.closed) {
      const n = st.pts.length;
      const fan = new Float32Array((n + 2) * 2);
      fan[0] = st.cx; fan[1] = st.cy;
      for (let i = 0; i <= n; i++) { const p = st.pts[i % n]; fan[2 + i * 2] = p[0]; fan[3 + i * 2] = p[1]; }
      m.fan = makeVAO(fan, [2]); m.fanN = n + 2;
      const b = st.bbox, e = 6;
      m.quad = makeVAO(new Float32Array([b[0] - e, b[1] - e, b[2] + e, b[1] - e, b[0] - e, b[3] + e, b[2] + e, b[3] + e]), [2]);
      m.inner = st.inner;
      m.dir = st.dir;
    }
    return m;
  }
  function meshFor(st) {
    let m = meshes.get(st.id);
    if (!m || m.ver !== st.ver || m.st !== st) { freeMesh(m); m = buildMesh(st); meshes.set(st.id, m); }
    return m;
  }
  function pruneMeshes() {
    if (!valley) return;
    const live = new Set(valley.streams.map((s) => s.id));
    for (const [id, m] of meshes) if (!live.has(id)) { freeMesh(m); meshes.delete(id); }
  }

  // ---------- light & colour through the day ----------
  const KEYS = [
    { t: 0.00, amb: [0.86, 0.80, 0.86], sat: 0.82, tint: [1.0, 0.97, 1.0], mist: 0.5, night: 0.1, deep: [0.21, 0.34, 0.47], shallow: [0.52, 0.63, 0.72] },
    { t: 0.12, amb: [1.0, 0.9, 0.84], sat: 0.92, tint: [1.03, 0.98, 0.96], mist: 0.25, night: 0.0, deep: [0.20, 0.35, 0.48], shallow: [0.47, 0.62, 0.68] },
    { t: 0.30, amb: [1.04, 1.03, 1.0], sat: 1.0, tint: [1, 1, 1], mist: 0.0, night: 0, deep: [0.15, 0.36, 0.47], shallow: [0.38, 0.62, 0.66] },
    { t: 0.50, amb: [1.07, 0.96, 0.82], sat: 1.07, tint: [1.04, 0.98, 0.9], mist: 0.0, night: 0, deep: [0.17, 0.33, 0.40], shallow: [0.47, 0.6, 0.56] },
    { t: 0.64, amb: [0.94, 0.68, 0.64], sat: 0.95, tint: [1.05, 0.89, 0.91], mist: 0.1, night: 0.12, deep: [0.21, 0.24, 0.40], shallow: [0.52, 0.47, 0.58] },
    { t: 0.79, amb: [0.44, 0.47, 0.72], sat: 0.76, tint: [0.93, 0.96, 1.1], mist: 0.08, night: 0.6, deep: [0.13, 0.18, 0.34], shallow: [0.30, 0.37, 0.55] },
    { t: 1.00, amb: [0.25, 0.29, 0.48], sat: 0.66, tint: [0.9, 0.96, 1.14], mist: 0.04, night: 1.0, deep: [0.1, 0.17, 0.32], shallow: [0.24, 0.34, 0.52] },
  ];
  function skyAt(tod) {
    let i = 0;
    while (i < KEYS.length - 2 && tod > KEYS[i + 1].t) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const t = U.smooth(U.clamp((tod - a.t) / (b.t - a.t), 0, 1));
    const mix = (x, y) => (Array.isArray(x) ? x.map((v, k) => U.lerp(v, y[k], t)) : U.lerp(x, y, t));
    const o = {};
    for (const k of ['amb', 'sat', 'tint', 'mist', 'night', 'deep', 'shallow']) o[k] = mix(a[k], b[k]);
    // the sun travels east -> south -> west; after dusk the moon lights from the north-west
    const dayT = U.clamp(tod / 0.7, 0, 1);
    const th = U.lerp(0.3, Math.PI - 0.3, dayT);
    let sx = Math.cos(th), sy = Math.sin(th), el = Math.sin(Math.PI * dayT) * 0.82 + 0.1;
    const nightT = U.smooth(U.clamp((tod - 0.66) / 0.16, 0, 1));
    sx = U.lerp(sx, -0.6, nightT); sy = U.lerp(sy, -0.8, nightT); el = U.lerp(el, 0.6, nightT);
    const L = Math.hypot(sx, sy) || 1;
    o.sun = [sx / L, sy / L, el];
    o.shadowLen = Math.min(3.2, Math.sqrt(1 - el * el) / Math.max(el, 0.18));
    o.shadowAlpha = 0.28 * (1 - 0.6 * o.night);
    return o;
  }

  // ---------- set-up ----------
  function init(cv) {
    canvas = cv;
    gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) return false;
    P.land = program(S.fullVS, S.landFS);
    P.water = program(S.stripVS, S.waterFS);
    P.shore = program(S.stripVS, S.shoreFS);
    P.pond = program(S.posVS, S.pondFS);
    P.flat = program(S.posVS, S.flatFS);
    P.sprite = program(S.spriteVS, S.spriteFS);
    P.comp = program(S.fullVS, S.compFS);
    P.copy = program(S.fullVS, S.copyFS);
    emptyVAO = gl.createVertexArray();
    spriteVAO = gl.createVertexArray();
    spriteVBO = gl.createBuffer();
    gl.bindVertexArray(spriteVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, spriteVBO);
    const sizes = [2, 2, 1, 1, 4, 4];
    let off = 0;
    sizes.forEach((sz, i) => {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, sz, gl.FLOAT, false, FL * 4, off);
      gl.vertexAttribDivisor(i, 1);
      off += sz * 4;
    });
    gl.bindVertexArray(null);
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); RS.render.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => location.reload());
    resize();
    return true;
  }
  function resize() {
    const cssW = Math.max(1, canvas.clientWidth), cssH = Math.max(1, canvas.clientHeight);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const maxPx = 4.6e6;
    if (cssW * cssH * dpr * dpr > maxPx) dpr = Math.sqrt(maxPx / (cssW * cssH));
    const w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    if (w === W && h === H && sceneFB) return;
    if ((W <= 4 || H <= 4) && w > 4 && h > 4) needHome = true;
    W = w; H = h;
    canvas.width = W; canvas.height = H;
    freeFB(sceneFB); freeFB(landFB);
    sceneFB = makeFB(W, H, true);
    landFB = makeFB(W, H, false);
    landKey = '';
  }
  function setValley(v) {
    for (const m of meshes.values()) freeMesh(m);
    meshes.clear();
    valley = v;
    landKey = '';
  }

  // ---------- camera ----------
  const cssW = () => W / dpr, cssH = () => H / dpr;
  function fitZoom() { return Math.min(cssW() / (M.WORLD.w + 120), cssH() / (M.WORLD.h + 120)); }
  function homeZoom() {
    const fz = fitZoom();
    return Math.max(fz, Math.min(1.6, Math.max(0.62, cssW() / 1500)));
  }
  function camFor(c, w, h, z, d) { return { x: c.x, y: c.y, sx: (z * d * 2) / w, sy: (z * d * 2) / h }; }
  function clampCam() {
    const hw = cssW() / 2 / cam.tz, hh = cssH() / 2 / cam.tz;
    const mx = Math.max(0, M.WORLD.w / 2 - hw + 80), my = Math.max(0, M.WORLD.h / 2 - hh + 80);
    cam.tx = U.clamp(cam.tx, M.WORLD.w / 2 - mx, M.WORLD.w / 2 + mx);
    cam.ty = U.clamp(cam.ty, M.WORLD.h / 2 - my, M.WORLD.h / 2 + my);
  }
  function updateCamera(dt) {
    if (needHome && cssW() >= 60 && cssH() >= 60) { needHome = false; home(true); }
    if (cam.tz < fitZoom() * 0.5) { cam.tz = cam.zoom = fitZoom(); }
    clampCam();
    const k = 1 - Math.exp(-dt * 14);
    cam.x += (cam.tx - cam.x) * k;
    cam.y += (cam.ty - cam.y) * k;
    cam.zoom *= Math.pow(cam.tz / cam.zoom, k);
    if (Math.abs(cam.tx - cam.x) < 0.01) cam.x = cam.tx;
    if (Math.abs(cam.ty - cam.y) < 0.01) cam.y = cam.ty;
    if (Math.abs(cam.tz / cam.zoom - 1) < 1e-4) cam.zoom = cam.tz;
  }
  function toWorld(cx, cy) { return { x: (cx - cssW() / 2) / cam.zoom + cam.x, y: (cy - cssH() / 2) / cam.zoom + cam.y }; }
  function toScreen(wx, wy) { return { x: (wx - cam.x) * cam.zoom + cssW() / 2, y: (wy - cam.y) * cam.zoom + cssH() / 2 }; }
  function zoomAt(cx, cy, factor) {
    const before = { x: (cx - cssW() / 2) / cam.tz + cam.tx, y: (cy - cssH() / 2) / cam.tz + cam.ty };
    cam.tz = U.clamp(cam.tz * factor, fitZoom() * 0.55, 4.5);
    cam.tx = before.x - (cx - cssW() / 2) / cam.tz;
    cam.ty = before.y - (cy - cssH() / 2) / cam.tz;
  }
  function panBy(dx, dy) { cam.tx -= dx / cam.tz; cam.ty -= dy / cam.tz; cam.x -= dx / cam.zoom; cam.y -= dy / cam.zoom; }
  function viewRect(margin = 60) {
    const hw = cssW() / 2 / cam.zoom, hh = cssH() / 2 / cam.zoom;
    return [cam.x - hw - margin, cam.y - hh - margin, cam.x + hw + margin, cam.y + hh + margin];
  }
  // frame what has been made so far (or the middle of the land when it is still empty)
  function home(instant) {
    if (cssW() < 60 || cssH() < 60) { needHome = true; return; }
    let b = null;
    if (valley) {
      for (const st of valley.streams) { const q = st.bbox; b = b ? [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])] : q.slice(); }
      for (const s of valley.stones) { b = b ? [Math.min(b[0], s.x), Math.min(b[1], s.y), Math.max(b[2], s.x), Math.max(b[3], s.y)] : [s.x, s.y, s.x, s.y]; }
    }
    if (b) {
      const pad = 150;
      const z = Math.min(cssW() / (b[2] - b[0] + pad * 2), cssH() / (b[3] - b[1] + pad * 2));
      cam.tz = U.clamp(z, Math.max(fitZoom(), Math.min(0.5, cssW() / 900)), 1.6);
      cam.tx = (b[0] + b[2]) / 2; cam.ty = (b[1] + b[3]) / 2;
    } else { cam.tz = homeZoom(); cam.tx = M.WORLD.w / 2; cam.ty = M.WORLD.h / 2; }
    clampCam();
    if (instant) { cam.x = cam.tx; cam.y = cam.ty; cam.zoom = cam.tz; }
  }
  function showAll() { cam.tz = fitZoom(); cam.tx = M.WORLD.w / 2; cam.ty = M.WORLD.h / 2; }

  // ---------- drawing ----------
  function renderLand(target, cm, sky, zoom, d) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
    gl.viewport(0, 0, target.w, target.h);
    gl.disable(gl.BLEND);
    gl.useProgram(P.land.p);
    set(P.land, 'uRes', target.w, target.h);
    set(P.land, 'uView', cm.x, cm.y, zoom, d);
    set(P.land, 'uSeed', (valley ? valley.seed : 1) % 1000);
    set(P.land, 'uWorld', M.WORLD.w, M.WORLD.h);
    set(P.land, 'uSun', sky.sun[0], sky.sun[1], sky.sun[2]);
    gl.bindVertexArray(emptyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function drawWater(cm, sky, B, time, zoom, extra) {
    const streams = valley ? valley.streams.slice() : [];
    if (extra) streams.push(extra);
    const lines = U.clamp((zoom - 0.32) / 0.45, 0, 1) * 0.95;
    // wet shores first
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(P.shore.p);
    set(P.shore, 'uCam', cm.x, cm.y, cm.sx, cm.sy);
    set(P.shore, 'uExtra', 9); set(P.shore, 'uWidthMul', 1);
    for (const st of streams) { const m = st === extra ? draftMesh : meshFor(st); gl.bindVertexArray(m.strip.vao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, m.n); }
    // ponds: fill the inside (even-odd stencil), then their circling water
    gl.enable(gl.STENCIL_TEST);
    for (const st of streams) {
      if (!st.closed) continue;
      const m = st === extra ? draftMesh : meshFor(st);
      gl.colorMask(false, false, false, false);
      gl.stencilMask(0x01);
      gl.stencilFunc(gl.ALWAYS, 0, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
      gl.useProgram(P.flat.p);
      set(P.flat, 'uCam', cm.x, cm.y, cm.sx, cm.sy);
      gl.bindVertexArray(m.fan.vao);
      gl.drawArrays(gl.TRIANGLE_FAN, 0, m.fanN);
      gl.colorMask(true, true, true, true);
      gl.stencilMask(0x80);
      gl.stencilFunc(gl.EQUAL, 0x81, 0x01);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
      gl.useProgram(P.pond.p);
      set(P.pond, 'uCam', cm.x, cm.y, cm.sx, cm.sy);
      set(P.pond, 'uC', st.cx, st.cy); set(P.pond, 'uD', st.D); set(P.pond, 'uBeat', B);
      set(P.pond, 'uDir', m.dir); set(P.pond, 'uSeed', (st.seed % 97) * 1.37); set(P.pond, 'uNight', sky.night);
      set(P.pond, 'uTime', time); set(P.pond, 'uSunEl', sky.sun[2]);
      set(P.pond, 'uDeep', ...sky.deep); set(P.pond, 'uShallow', ...sky.shallow);
      gl.bindVertexArray(m.quad.vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // clear the even-odd bit for the next pond
      gl.colorMask(false, false, false, false);
      gl.stencilMask(0x01);
      gl.stencilFunc(gl.ALWAYS, 0, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.ZERO);
      gl.useProgram(P.flat.p);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.colorMask(true, true, true, true);
    }
    // flowing water, marking the stencil so ripples stay on the water
    gl.stencilMask(0x80);
    gl.stencilFunc(gl.ALWAYS, 0x80, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    gl.useProgram(P.water.p);
    set(P.water, 'uCam', cm.x, cm.y, cm.sx, cm.sy);
    set(P.water, 'uExtra', 0); set(P.water, 'uWidthMul', 1);
    set(P.water, 'uBeat', B); set(P.water, 'uTime', time); set(P.water, 'uNight', sky.night);
    set(P.water, 'uZoom', zoom); set(P.water, 'uLines', lines); set(P.water, 'uSunEl', sky.sun[2]);
    set(P.water, 'uDeep', ...sky.deep); set(P.water, 'uShallow', ...sky.shallow);
    for (const st of streams) {
      const m = st === extra ? draftMesh : meshFor(st);
      set(P.water, 'uK', st.k); set(P.water, 'uD', st.D); set(P.water, 'uRing', st.closed ? 1 : 0);
      set(P.water, 'uSeed', (st.seed % 89) * 1.71); set(P.water, 'uInner', m.inner || 0);
      set(P.water, 'uGlow', st === extra ? 0.6 : (st._glow || 0));
      gl.bindVertexArray(m.strip.vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, m.n);
    }
    gl.stencilMask(0xff);
    gl.disable(gl.STENCIL_TEST);
    gl.bindVertexArray(null);
  }
  function frame(B, time, sky, opt = {}) {
    if (!gl || RS.render.lost) return;
    const target = opt.target || null;
    const tw = target ? target.w : W, th = target ? target.h : H;
    const d = target ? target.dpr : dpr;
    const zoom = target ? target.zoom : cam.zoom;
    const center = target ? target.center : cam;
    const cm = camFor(center, tw, th, zoom, d);
    // cached land
    const key = [center.x.toFixed(2), center.y.toFixed(2), zoom.toFixed(5), tw, th, valley ? valley.seed : 0, sky.sun.map((x) => x.toFixed(2)).join(',')].join('|');
    const landTarget = target ? target.land : landFB;
    if (target || key !== landKey) { renderLand(landTarget, cm, sky, zoom, d); if (!target) landKey = key; }
    const scene = target ? target.scene : sceneFB;
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fb);
    gl.viewport(0, 0, tw, th);
    gl.clearStencil(0);
    gl.clear(gl.STENCIL_BUFFER_BIT);
    gl.disable(gl.BLEND);
    gl.useProgram(P.copy.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, landTarget.tex);
    gl.uniform1i(P.copy.u.uTex, 0);
    set(P.copy, 'uRes', tw, th);
    gl.bindVertexArray(emptyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (opt.draft && !target) {
      if (draftMesh) freeMesh(draftMesh);
      draftMesh = buildMesh(opt.draft);
    }
    drawWater(cm, sky, B, time, zoom, target ? null : opt.draft);
    // sprites
    gl.useProgram(P.sprite.p);
    set(P.sprite, 'uSun', sky.sun[0], sky.sun[1], sky.sun[2]);
    set(P.sprite, 'uTime', time);
    set(P.sprite, 'uAdd', 0);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (!target) {
      gl.enable(gl.STENCIL_TEST);
      gl.stencilMask(0x00);
      gl.stencilFunc(gl.EQUAL, 0x80, 0x80);
      drawBatch(batches.ripple, cm);
      gl.disable(gl.STENCIL_TEST);
      gl.stencilMask(0xff);
    }
    const bs = opt.batches || batches;
    drawBatch(bs.under, cm);
    drawBatch(bs.shadow, cm);
    drawBatch(bs.obj, cm);
    drawBatch(bs.over, cm);
    // final light and colour
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.out.fb : null);
    gl.viewport(0, 0, tw, th);
    gl.disable(gl.BLEND);
    gl.useProgram(P.comp.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.uniform1i(P.comp.u.uScene, 0);
    set(P.comp, 'uRes', tw, th);
    set(P.comp, 'uAmb', ...sky.amb); set(P.comp, 'uSat', sky.sat); set(P.comp, 'uTint', ...sky.tint);
    set(P.comp, 'uMist', target ? 0 : sky.mist); set(P.comp, 'uTime', time); set(P.comp, 'uNight', sky.night);
    set(P.comp, 'uMistOff', time * 0.012, time * 0.004);
    const lights = opt.lights || [];
    const LA = new Float32Array(24 * 4), LC = new Float32Array(24 * 3);
    let nl = 0;
    for (const L of lights) {
      if (nl >= 24) break;
      const sx = (L.x - center.x) * zoom * d + tw / 2, sy = th - ((L.y - center.y) * zoom * d + th / 2);
      const r = L.r * zoom * d;
      if (sx < -r || sx > tw + r || sy < -r || sy > th + r) continue;
      LA.set([sx, sy, r, L.i], nl * 4); LC.set(L.c, nl * 3); nl++;
    }
    gl.uniform1i(P.comp.u.uNL, nl);
    if (P.comp.u.uL) gl.uniform4fv(P.comp.u.uL, LA);
    if (P.comp.u.uLC) gl.uniform3fv(P.comp.u.uLC, LC);
    gl.bindVertexArray(emptyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // glows on top, unaffected by darkness
    if (bs.glow.n) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(P.sprite.p);
      set(P.sprite, 'uAdd', 1);
      drawBatch(bs.glow, cm);
      set(P.sprite, 'uAdd', 0);
      gl.disable(gl.BLEND);
    }
  }
  // a small painting of the whole valley, for the atlas
  function thumbnail(w, h, sky, B, time, fill) {
    if (!gl) return null;
    const t = { w, h, dpr: 1, land: makeFB(w, h, false), scene: makeFB(w, h, true), out: makeFB(w, h, false) };
    t.zoom = Math.min(w / M.WORLD.w, h / M.WORLD.h) * 1.02;
    t.center = { x: M.WORLD.w / 2, y: M.WORLD.h / 2 };
    const tb = { ripple: new Batch(64), under: new Batch(), shadow: new Batch(), obj: new Batch(), over: new Batch(), glow: new Batch() };
    fill && fill(tb, t);
    frame(B, time, sky, { target: t, batches: tb, lights: [] });
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.out.fb);
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    freeFB(t.land); freeFB(t.scene); freeFB(t.out);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cx = c.getContext('2d');
    const img = cx.createImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    cx.putImageData(img, 0, 0);
    return c;
  }

  return {
    init, resize, setValley, frame, thumbnail, skyAt, pruneMeshes, Batch,
    toWorld, toScreen, zoomAt, panBy, viewRect, home, showAll, fitZoom, homeZoom, updateCamera, clampCam,
    invalidate(st) { if (st) st.ver++; },
    get batches() { return batches; },
    get cam() { return cam; },
    get gl() { return gl; },
    get dpr() { return dpr; },
    get cssW() { return cssW(); },
    get cssH() { return cssH(); },
    lost: false,
  };
})();
