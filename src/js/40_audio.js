/* Riversong — sound: real instrument samples (VCSL, CC0), voices, a valley-sized reverb and an echo. */
'use strict';
RS.audio = (() => {
  const U = RS.util;
  let ctx = null, master = null, out = null, ready = false, muted = false;
  const banks = {};       // group -> [{buf, p, off, ls, le, g}]
  const buses = {};       // family -> GainNode
  let revIn, echoIn, echoDelay, ambGain;
  const active = [];      // one-shot voices for polyphony control
  const reeds = new Map();// key -> {src, gain, reed, base}
  const MAX_VOICES = 56;
  let rr = 0;             // round robin counter
  let mode = 1;

  // ---------- set-up ----------
  function create() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC({ latencyHint: 'interactive' });
    RS.clock.attach(ctx);
    // master chain: gentle glue compression, then a safety limiter
    master = ctx.createGain(); master.gain.value = 0.62;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 14; comp.ratio.value = 3; comp.attack.value = 0.012; comp.release.value = 0.3;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -2.5; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.12;
    out = ctx.createGain(); out.gain.value = 1;
    master.connect(comp); comp.connect(lim); lim.connect(out); out.connect(ctx.destination);
    // reverb: a generated valley-sized impulse response
    const conv = ctx.createConvolver();
    conv.buffer = impulse(3.4, 0.022);
    revIn = ctx.createGain(); revIn.gain.value = 1;
    const revOut = ctx.createGain(); revOut.gain.value = 0.55;
    const revHP = ctx.createBiquadFilter(); revHP.type = 'highpass'; revHP.frequency.value = 160;
    revIn.connect(revHP); revHP.connect(conv); conv.connect(revOut); revOut.connect(master);
    // echo: a soft dotted-eighth echo, darker on every repeat (the visible echo of each ripple)
    echoIn = ctx.createGain(); echoIn.gain.value = 1;
    echoDelay = ctx.createDelay(4); echoDelay.delayTime.value = 0.75 * 60 / RS.clock.bpm;
    const fb = ctx.createGain(); fb.gain.value = 0.34;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2300;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 260;
    const echoOut = ctx.createGain(); echoOut.gain.value = 0.42;
    echoIn.connect(echoDelay); echoDelay.connect(lp); lp.connect(hp); hp.connect(fb); fb.connect(echoDelay);
    hp.connect(echoOut); echoOut.connect(master); echoOut.connect(revIn);
    // instrument families: [dry, reverb send, echo send]
    const fam = { stone: [0.92, 0.34, 0.2], reed: [0.85, 0.5, 0.0], drum: [0.95, 0.22, 0.0], gravel: [0.8, 0.18, 0.06], fx: [0.8, 0.55, 0.0], drop: [0.7, 0.4, 0.1] };
    for (const k in fam) {
      const g = ctx.createGain(); g.gain.value = 1;
      const d = ctx.createGain(); d.gain.value = fam[k][0]; g.connect(d); d.connect(master);
      const r = ctx.createGain(); r.gain.value = fam[k][1]; g.connect(r); r.connect(revIn);
      if (fam[k][2] > 0) { const e = ctx.createGain(); e.gain.value = fam[k][2]; g.connect(e); e.connect(echoIn); }
      buses[k] = g;
    }
    ambience();
    return ctx;
  }
  function impulse(sec, pre) {
    const sr = ctx.sampleRate, n = Math.floor(sec * sr), buf = ctx.createBuffer(2, n, sr);
    const r = U.rng(1234);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      const p0 = Math.floor(pre * sr);
      for (let i = p0; i < n; i++) {
        const t = (i - p0) / sr;
        const env = Math.exp(-t * 6.91 / (sec * 0.82)) * (t < 0.02 ? t / 0.02 : 1);
        const a = 0.18 + 0.75 * Math.min(1, t / sec); // darker as it decays
        lp += (r() * 2 - 1 - lp) * (1 - a);
        d[i] = lp * env * 0.9;
      }
      // a few early reflections from the valley walls
      for (let k = 0; k < 7; k++) {
        const i = p0 + Math.floor((0.012 + r() * 0.07) * sr);
        if (i < n) d[i] += (r() * 2 - 1) * 0.5 * (1 - k / 8);
      }
    }
    return buf;
  }
  function ambience() {
    // running water: two looping noise layers shaped into a soft babble
    const sr = ctx.sampleRate, n = sr * 4;
    const buf = ctx.createBuffer(2, n, sr);
    const r = U.rng(77);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b = 0;
      for (let i = 0; i < n; i++) { b = b * 0.985 + (r() * 2 - 1) * 0.15; d[i] = b; }
      // make the loop seamless
      const F = 2000;
      for (let i = 0; i < F; i++) { const t = i / F; d[n - F + i] = d[n - F + i] * (1 - t) + d[i] * t; }
    }
    ambGain = ctx.createGain(); ambGain.gain.value = 0;
    const mk = (f, q, rate) => {
      const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07 + rate * 0.05;
      const lg = ctx.createGain(); lg.gain.value = f * 0.35;
      lfo.connect(lg); lg.connect(bp.frequency); lfo.start();
      s.connect(bp); bp.connect(ambGain); s.start();
    };
    mk(520, 0.7, 1.0); mk(1500, 1.1, 1.37);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 120;
    ambGain.connect(hp); hp.connect(master);
  }
  async function load(onProgress) {
    const S = window.RS_SAMPLES || {};
    const jobs = [];
    let done = 0, total = 0;
    for (const group in S) for (const it of S[group]) total++;
    for (const group in S) {
      banks[group] = [];
      for (const it of S[group]) {
        const entry = { p: it.p, g: it.g || 1, ls: it.ls, le: it.le, buf: null, off: 0 };
        banks[group].push(entry);
        jobs.push(decode(it.d).then((buf) => {
          entry.buf = buf;
          const d = buf.getChannelData(0);
          let pk = 0;
          for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > pk) pk = a; }
          let on = 0;
          for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > pk * 0.01) { on = i; break; }
          entry.off = Math.max(0, on / buf.sampleRate - 0.002);
        }).catch(() => {}).then(() => { done++; onProgress && onProgress(done / total); }));
      }
    }
    await Promise.all(jobs);
    for (const g in banks) {
      banks[g] = banks[g].filter((e) => e.buf);
      if (banks[g][0] && banks[g][0].p != null) banks[g].sort((a, b) => a.p - b.p);
    }
    ready = true;
  }
  function decode(b64) {
    const ab = U.b64ToArrayBuffer(b64);
    return new Promise((res, rej) => {
      const p = ctx.decodeAudioData(ab, res, rej);
      if (p && p.then) p.then(res, rej);
    });
  }
  async function resume() {
    if (!ctx) return;
    if (ctx.state !== 'running') {
      try { await ctx.resume(); } catch (e) { /* needs a gesture */ }
    }
    RS.clock.sync();
  }

  // ---------- voices ----------
  function nearestSample(group, midi) {
    const b = banks[group];
    if (!b || !b.length) return null;
    let best = b[0], bd = 1e9;
    for (const e of b) { const d = Math.abs(e.p - midi) + (e.p < midi ? 0.4 : 0); if (d < bd) { bd = d; best = e; } }
    return best;
  }
  function trim() {
    const now = ctx.currentTime;
    for (let i = active.length - 1; i >= 0; i--) if (active[i].end < now) active.splice(i, 1);
    while (active.length > MAX_VOICES) {
      const v = active.shift();
      try { v.g.gain.cancelScheduledValues(now); v.g.gain.setTargetAtTime(0, now, 0.015); v.src.stop(now + 0.08); } catch (e) { /* already stopped */ }
    }
  }
  function play(entry, when, o) {
    if (!entry || !entry.buf) return null;
    const t = Math.max(when, ctx.currentTime + 0.005);
    const src = ctx.createBufferSource();
    src.buffer = entry.buf;
    src.playbackRate.value = o.rate || 1;
    const g = ctx.createGain();
    const gain = (o.gain == null ? 1 : o.gain) * entry.g;
    if (o.attack) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + o.attack); }
    else g.gain.setValueAtTime(gain, t);
    let node = g;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = U.clamp(o.pan || 0, -1, 1); g.connect(p); node = p; }
    node.connect(buses[o.family] || master);
    src.connect(g);
    const dur = (entry.buf.duration - entry.off) / (o.rate || 1);
    src.start(t, entry.off);
    const v = { src, g, end: t + dur };
    if (o.dur) { g.gain.setTargetAtTime(0, t + o.dur, o.release || 0.08); src.stop(t + o.dur + (o.release || 0.08) * 6); v.end = t + o.dur + 0.5; }
    active.push(v);
    trim();
    return v;
  }
  const when = (beat) => RS.clock.ctxTime(beat);
  const ok = () => ctx && ready && ctx.state === 'running';

  // ---------- instruments ----------
  function stone(k, beat, o = {}) {
    if (!ok()) return;
    const midi = RS.music.stoneMidi(k, o.mode != null ? o.mode : mode);
    const t = when(beat);
    const vel = (0.72 + 0.28 * (k / 15)) * (o.vel || 1) * (0.94 + Math.random() * 0.12);
    const m = nearestSample('marimba', midi), v = nearestSample('vibes', midi);
    if (m) play(m, t, { family: 'stone', rate: Math.pow(2, (midi - m.p) / 12), gain: 0.95 * vel, pan: o.pan });
    if (v) play(v, t + 0.004, { family: 'stone', rate: Math.pow(2, (midi - v.p) / 12), gain: (k > 11 ? 0.3 : 0.44) * vel, pan: (o.pan || 0) * 0.8 });
  }
  function preview(k, o = {}) { if (!ok()) return; stone(k, RS.clock.beat(ctx.currentTime + RS.clock.ctxOff + 0.01), o); }
  function reedPreview(k, o = {}) {
    if (!ok()) return;
    const key = 'preview:' + Math.random();
    const b = RS.clock.beat(ctx.currentTime + RS.clock.ctxOff + 0.01);
    reedOn(key, k, b, o);
    reedOff(key, b + 0.9);
  }
  function reedOn(key, k, beat, o = {}) {
    if (!ok() || reeds.has(key)) return;
    const midi = RS.music.reedMidi(k, mode);
    const e = nearestSample('organ', midi);
    if (!e) return;
    const t = Math.max(when(beat), ctx.currentTime + 0.005);
    const src = ctx.createBufferSource();
    src.buffer = e.buf;
    src.loop = true;
    src.loopStart = e.ls + e.off; src.loopEnd = e.le + e.off;
    src.playbackRate.value = Math.pow(2, (midi - e.p) / 12);
    const g = ctx.createGain();
    const level = 0.19 * e.g * (o.vel || 1) * (k > 9 ? 1.2 : 1);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level * 0.75, t + 0.12);
    g.gain.linearRampToValueAtTime(level, t + 0.45);
    let node = g;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = U.clamp(o.pan || 0, -1, 1) * 0.6; g.connect(p); node = p; }
    node.connect(buses.reed);
    src.connect(g);
    src.start(t, e.off);
    reeds.set(key, { src, g, k, e, start: t, level });
    // safety: never let a forgotten reed hum forever
    const cap = t + 40;
    g.gain.setTargetAtTime(0, cap, 0.5); src.stop(cap + 3);
  }
  function reedOff(key, beat) {
    const r = reeds.get(key);
    if (!r || !ctx) return;
    reeds.delete(key);
    const t = Math.max(when(beat), ctx.currentTime + 0.005, r.start + 0.2);
    try {
      r.g.gain.cancelScheduledValues(t);
      r.g.gain.setTargetAtTime(0, t, 0.22);
      r.src.stop(t + 1.6);
    } catch (e) { /* ignore */ }
  }
  function retune(newMode, beat) {
    mode = newMode;
    if (!ctx) return;
    const t = Math.max(when(beat), ctx.currentTime + 0.01);
    for (const r of reeds.values()) {
      const midi = RS.music.reedMidi(r.k, mode);
      try { r.src.playbackRate.setValueAtTime(r.src.playbackRate.value, t); r.src.playbackRate.linearRampToValueAtTime(Math.pow(2, (midi - r.e.p) / 12), t + 0.45); } catch (e) { /* ignore */ }
    }
  }
  function fall(size, beat, o = {}) {
    if (!ok()) return;
    const t = when(beat);
    const vr = 0.97 + Math.random() * 0.06;
    const B = banks.bass || [], F = banks.frame || [], S = banks.frameS || [];
    rr++;
    if (size >= 2) { // a fall out of a wide pool: deep
      play(B[rr % B.length], t, { family: 'drum', rate: 0.92 * vr, gain: 1.0, pan: o.pan });
      play(F[rr % F.length], t, { family: 'drum', rate: 0.86 * vr, gain: 0.5, pan: o.pan });
    } else if (size === 1) {
      play(F[rr % F.length], t, { family: 'drum', rate: vr, gain: 0.9, pan: o.pan });
      play(B[rr % B.length], t, { family: 'drum', rate: 1.05 * vr, gain: 0.42, pan: o.pan });
    } else { // narrow, quick water: a smaller, tighter thump
      play(S[0], t, { family: 'drum', rate: vr, gain: 0.85, pan: o.pan });
      play(F[rr % F.length], t, { family: 'drum', rate: 1.12 * vr, gain: 0.35, pan: o.pan });
    }
  }
  function gravel(beat, accent, o = {}) {
    if (!ok()) return;
    const t = when(beat);
    const S = banks.shaker || [];
    rr++;
    play(S[rr % S.length], t, { family: 'gravel', rate: 0.94 + Math.random() * 0.12, gain: accent ? 0.5 : 0.3, pan: o.pan });
    if (accent && banks.cabasa) play(banks.cabasa[0], t, { family: 'gravel', rate: 0.96 + Math.random() * 0.08, gain: 0.22, pan: -(o.pan || 0) * 0.5 });
  }
  function release(beat, o = {}) {
    if (!ok()) return;
    const t = when(beat);
    if (banks.whoosh) play(banks.whoosh[0], t - 0.25, { family: 'fx', gain: 0.6, attack: 0.3, pan: o.pan });
    if (banks.gong) play(banks.gong[0], t, { family: 'fx', gain: 0.42, rate: 0.84, pan: (o.pan || 0) * 0.5 });
  }
  function bell(beat, o = {}) {
    if (!ok() || !banks.bell) return;
    play(banks.bell[0], when(beat), { family: 'fx', gain: 0.22, rate: o.rate || 1, pan: o.pan });
  }
  function drop(beat, o = {}) {
    if (!ok()) return;
    const t = Math.max(when(beat), ctx.currentTime + 0.005);
    const osc = ctx.createOscillator(), g = ctx.createGain();
    const f0 = 700 + Math.random() * 900;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 2.4, t + 0.045);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05 * (o.vel || 1), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
    osc.connect(g);
    let node = g;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = U.clamp(o.pan || 0, -1, 1); g.connect(p); node = p; }
    node.connect(buses.drop);
    osc.start(t); osc.stop(t + 0.12);
  }
  function setAmbience(level) {
    if (!ctx || !ambGain) return;
    ambGain.gain.setTargetAtTime(muted ? 0 : level, ctx.currentTime, 0.8);
  }
  function setMuted(m) {
    muted = m;
    if (out && ctx) out.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.05);
  }
  function setBpm(bpm) { if (echoDelay && ctx) echoDelay.delayTime.setTargetAtTime(0.75 * 60 / bpm, ctx.currentTime, 0.05); }
  function silenceReeds(beat) { for (const key of [...reeds.keys()]) reedOff(key, beat); }
  // a copy of the final mix as a MediaStream (used for checking the sound, or recording a valley)
  function stream() { const d = ctx.createMediaStreamDestination(); out.connect(d); return d.stream; }

  return {
    create, load, resume, stone, preview, reedPreview, reedOn, reedOff, retune, fall, gravel, release, bell, drop,
    setAmbience, setMuted, setBpm, silenceReeds, stream,
    get ctx() { return ctx; },
    get ready() { return ready; },
    get running() { return !!ctx && ctx.state === 'running'; },
    get muted() { return muted; },
    set mode(m) { mode = m; },
    get mode() { return mode; },
  };
})();
