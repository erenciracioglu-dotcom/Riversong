/* Riversong — press and hold on open land: rain. Each drop lands on the beat grid and plays the stone it hits. */
'use strict';
RS.rain = (() => {
  const M = RS.model, U = RS.util, MU = RS.music;
  let cloud = null;            // {x, y, t0, next, fade}
  const drops = [];            // {x, y, beat, t0}
  const RADIUS = 95;
  const FALL = 0.42;           // seconds a drop is seen falling

  function start(x, y) { cloud = { x, y, t0: performance.now() / 1000, next: 0, alive: true }; }
  function move(x, y) { if (cloud) { cloud.x = x; cloud.y = y; } }
  function stop() { if (cloud) { cloud.alive = false; cloud.end = performance.now() / 1000; } }
  function cancel() { cloud = null; }

  function spawn(V, beatNow) {
    const near = V.stones.filter((s) => Math.hypot(s.x - cloud.x, s.y - cloud.y) < RADIUS && RS.sim.stoneAttach(s.id));
    let x, y, stone = null;
    if (near.length && Math.random() < 0.62) {
      stone = near[Math.floor(Math.random() * near.length)];
      const r = MU.stoneRadius(stone.size) * 0.6;
      const a = Math.random() * Math.PI * 2;
      x = stone.x + Math.cos(a) * r * Math.random(); y = stone.y + Math.sin(a) * r * Math.random();
    } else {
      const a = Math.random() * Math.PI * 2, r = RADIUS * Math.sqrt(Math.random());
      x = cloud.x + Math.cos(a) * r; y = cloud.y + Math.sin(a) * r;
      for (const s of near) if (Math.hypot(s.x - x, s.y - y) < MU.stoneRadius(s.size)) { stone = s; break; }
    }
    const bps = RS.clock.bpm / 60;
    const beat = Math.ceil((beatNow + FALL * bps) * 4) / 4;   // land on the next sixteenth
    const onWater = !!M.hitWater(V, x, y, 0);
    const pan = RS.input.panX(x);
    if (stone) RS.audio.stone(stone.size, beat, { pan, vel: 0.62 + Math.random() * 0.25 });
    else if (onWater) RS.audio.drop(beat, { pan, vel: 0.8 + Math.random() * 0.4 });
    RS.fx.push({ type: 'drop', beat, x, y, onWater: onWater || !!stone, stone });
    drops.push({ x, y, beat, t0: performance.now() / 1000 });
  }
  function tick(V, beatNow) {
    if (!cloud || !V) return;
    const t = performance.now() / 1000;
    if (!cloud.alive) { if (t - cloud.end > 1.2) cloud = null; return; }
    const age = t - cloud.t0;
    const rate = U.clamp(0.08 - age * 0.012, 0.045, 0.08); // rain builds up
    while (cloud.next <= t) {
      if (cloud.next > 0) spawn(V, beatNow);
      cloud.next = (cloud.next || t) + rate * (0.6 + Math.random() * 0.8);
    }
  }
  function draw(bt, tSec, sky) {
    const heard = RS.clock.heardBeat();
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      const left = RS.clock.secOfBeat(d.beat) - RS.clock.secOfBeat(heard);
      if (left < -0.05) { drops.splice(i, 1); continue; }
      const k = U.clamp(1 - left / FALL, 0, 1);
      if (k <= 0) continue;
      const h = (1 - k) * 34;
      bt.shadow.add(d.x, d.y, 1.6 + k, 1.6 + k, 0, 4, 0, 0, 0, 0, 0.1, 0.12, 0.16, 0.15 + 0.25 * k);
      bt.over.add(d.x - h * 0.25, d.y - h, 1.2, 2.4 + (1 - k) * 2, -0.25, 6, 1.2, 0, 0, 0, 0.82, 0.9, 1, 0.75 * k);
    }
    if (cloud) {
      const t = performance.now() / 1000;
      const a = cloud.alive ? U.clamp((t - cloud.t0) / 0.6, 0, 1) : U.clamp(1 - (t - cloud.end) / 1.2, 0, 1);
      bt.shadow.add(cloud.x + 10, cloud.y + 6, RADIUS * 1.35, RADIUS * 1.15, 0.2, 13, cloud.t0 % 10, 0, 0, 0, 0.12, 0.14, 0.2, 0.28 * a);
    }
  }
  return { start, move, stop, cancel, tick, draw, get active() { return !!(cloud && cloud.alive); } };
})();
