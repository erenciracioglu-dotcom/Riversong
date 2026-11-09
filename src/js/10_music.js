/* Riversong — tuning, time-of-day modes and the song clock. */
'use strict';
RS.music = (() => {
  // Everything is pentatonic on the same tonic (D), so nothing can clash.
  // Turning the day rotates which five notes are used: same river, different feeling.
  const BASE = 50; // D3
  const MODES = [
    { name: 'dawn', steps: [0, 2, 5, 7, 9] },   // ritsu / yo: open, hopeful
    { name: 'day', steps: [0, 2, 4, 7, 9] },    // major pentatonic: bright
    { name: 'golden', steps: [0, 2, 5, 7, 10] },// suspended: warm, airy
    { name: 'dusk', steps: [0, 3, 5, 7, 10] },  // minor pentatonic: wistful
    { name: 'night', steps: [0, 3, 5, 8, 10] }, // man gong: deep, dark
  ];
  const EDGES = [0.15, 0.42, 0.58, 0.78];
  const STONE_SIZES = 16; // 0 = smallest pebble (D6) … 15 = biggest boulder (D3)
  const REED_SIZES = 14;  // 0 = shortest reed (A4) … 13 = tallest bulrush (D2)
  function modeAt(tod) { let m = 0; while (m < 4 && tod >= EDGES[m]) m++; return m; }
  function degreeMidi(i, mode) {
    const st = MODES[mode].steps;
    const o = Math.floor(i / 5), d = ((i % 5) + 5) % 5;
    return BASE + 12 * o + st[d];
  }
  const stoneMidi = (k, mode) => degreeMidi(15 - k, mode);
  const reedMidi = (k, mode) => degreeMidi(8 - k, mode);
  const stoneRadius = (k) => 3.1 + k * 0.6;
  const reedHeight = (k) => 11 + k * 2.3;
  return { MODES, EDGES, STONE_SIZES, REED_SIZES, modeAt, degreeMidi, stoneMidi, reedMidi, stoneRadius, reedHeight };
})();

// The song clock: one beat counter shared by sound and picture.
// It follows the audio hardware clock when sound is running, else the page clock, without jumps.
RS.clock = {
  bpm: 84,
  secAnchor: 0,
  beatAnchor: 0,
  ctx: null,
  useCtx: false,
  ctxOff: 0,
  perfOff: 0,
  attach(ctx) {
    this.ctx = ctx;
    this.sync = () => {
      const r = ctx.state === 'running';
      if (r && !this.useCtx) {
        const t = performance.now() / 1000 + this.perfOff;
        this.ctxOff = t - ctx.currentTime;
        this.useCtx = true;
      } else if (!r && this.useCtx) {
        const t = ctx.currentTime + this.ctxOff;
        this.perfOff = t - performance.now() / 1000;
        this.useCtx = false;
      }
    };
    ctx.addEventListener('statechange', this.sync);
    this.sync();
  },
  sync() {},
  // time used for scheduling sound (the audio render clock)
  now() { return this.useCtx ? this.ctx.currentTime + this.ctxOff : performance.now() / 1000 + this.perfOff; },
  // time the listener is hearing right now (for drawing, so picture and sound line up)
  heard() {
    if (!this.useCtx) return performance.now() / 1000 + this.perfOff;
    const c = this.ctx;
    if (c.getOutputTimestamp) {
      const ts = c.getOutputTimestamp();
      if (ts && ts.contextTime > 0 && ts.performanceTime > 0) {
        const t = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
        if (Math.abs(t - c.currentTime) < 0.5) return t + this.ctxOff;
      }
    }
    return c.currentTime - (c.outputLatency || c.baseLatency || 0) + this.ctxOff;
  },
  beat(t) { return this.beatAnchor + ((t === undefined ? this.now() : t) - this.secAnchor) * this.bpm / 60; },
  heardBeat() { return this.beat(this.heard()); },
  secOfBeat(b) { return this.secAnchor + (b - this.beatAnchor) * 60 / this.bpm; },
  ctxTime(b) { return this.secOfBeat(b) - this.ctxOff; },
  setBpm(bpm) { const t = this.now(); this.beatAnchor = this.beat(t); this.secAnchor = t; this.bpm = bpm; },
};
