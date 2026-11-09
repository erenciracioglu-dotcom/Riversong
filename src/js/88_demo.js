/* Riversong — the first valley you meet: a river with a split ending, two ponds in 6 and 8,
   and a dammed brook full of pebbles waiting to pour out. */
'use strict';
RS.demo = (() => {
  const M = RS.model, U = RS.util;
  function catmull(ctrl, per = 10) {
    const out = [];
    for (let i = 0; i < ctrl.length - 1; i++) {
      const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
      for (let k = 0; k < per; k++) {
        const t = k / per, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    out.push(ctrl[ctrl.length - 1].slice());
    return U.resample(out, M.STEP, false);
  }
  function ellipse(cx, cy, rx, ry, a0, wob, seed) {
    const pts = [];
    const n = 160;
    for (let i = 0; i < n; i++) {
      const t = a0 + (i / n) * Math.PI * 2;
      const w = 1 + wob * U.noise1(i / n * 6, seed);
      pts.push([cx + Math.cos(t) * rx * w, cy + Math.sin(t) * ry * w]);
    }
    return U.resample(pts, M.STEP, true);
  }
  function make() {
    const T = RS.i18n.t();
    const v = M.newValley({ name: T.demoName, tod: 0.3, seed: 4242 });
    const add = (st) => { v.streams.push(st); M.index(v); return st; };
    // the long river: 22 beats of water, a slow pool before a fall, splitting near the end
    const speed = new Array(22).fill(1); speed[8] = 0.5; speed[9] = 0.5;
    const river = add(M.makeStream({ pts: catmull([[150, 640], [290, 585], [430, 610], [560, 680], [690, 740], [830, 750], [960, 700], [1080, 640], [1210, 650], [1330, 700]]), U: 22, speed, seed: 101 }));
    const P18 = M.pointAtU(river, 18);
    const branch = add(M.makeStream({ pts: catmull([[P18.x, P18.y], [P18.x + 45, P18.y + 62], [P18.x + 105, P18.y + 118], [P18.x + 175, P18.y + 150]]), U: 4, startAttach: { sid: river.id, u: 18 }, seed: 202 }));
    const P14 = M.pointAtU(river, 14);
    const brook = add(M.makeStream({ pts: catmull([[1190, 225], [1125, 325], [1062, 425], [1000, 520], [P14.x + 34, P14.y - 100], [P14.x, P14.y]]), U: 10, endAttach: { sid: river.id, u: 14 }, seed: 303 }));
    const pondA = add(M.makeStream({ pts: ellipse(560, 300, 62, 46, Math.PI / 2, 0.05, 7), closed: true, U: 6, seed: 404 }));
    const pondB = add(M.makeStream({ pts: ellipse(800, 270, 82, 62, Math.PI / 2, 0.06, 9), closed: true, U: 8, seed: 505 }));
    // stones: [u, size, lateral offset]
    let sseed = 1;
    const stone = (st, u, k, lat = 0) => {
      const p = M.pointAtU(st, u);
      v.stones.push({ id: U.uid('t'), x: p.x - p.ty * lat, y: p.y + p.tx * lat, size: k, seed: ((sseed++ * 0.6180339887) % 1) });
    };
    // river melody (D pentatonic): A D E F# E D B A F# | pool: E D A B | fall | F# A B A F# E D E | ending
    [[0, 7], [1, 5], [2, 4], [2.5, 3, 4], [3, 4], [4, 5], [5, 6], [6, 7, -4], [7, 8],
      [8, 9, 3], [8.5, 10, -5], [9, 12, 4], [9.5, 11, -3],
      [11, 8], [12, 7, 3], [12.5, 6, -3], [13, 7], [14.5, 8, 4], [15, 9], [16, 10, -3], [17, 9, 3],
      [18.6, 8, 3], [19, 7], [20, 9, -3], [21, 10]].forEach(([u, k, lat]) => stone(river, u, k, lat || 0));
    // the other ending
    [[0.6, 6, 2], [1, 7], [2.5, 5], [3, 2, -2]].forEach(([u, k, lat]) => stone(branch, u, k, lat || 0));
    // a cascade waiting below the dam
    [[2.5, 0], [3, 1], [3.5, 2], [4, 3], [4.5, 4], [5, 5], [6, 7], [7, 8]].forEach(([u, k], i) => stone(brook, u, k, (i % 2 ? 4 : -4)));
    // pond in six: floating high notes; pond in eight: a walking bass
    [[0, 5], [1.5, 2], [3, 3], [4.5, 4]].forEach(([u, k]) => stone(pondA, u, k, 3 * pondA.inner));
    [[0, 15], [3, 12], [5, 13], [6.5, 14]].forEach(([u, k]) => stone(pondB, u, k, 5 * pondB.inner));
    // reeds: a low D drone at the spring, an A further on, a small D4 around the little pond
    v.reeds.push({ id: U.uid('r'), sid: river.id, a: 0, b: 6, side: -1, size: 8, seed: 11 });
    v.reeds.push({ id: U.uid('r'), sid: river.id, a: 11, b: 17, side: 1, size: 5, seed: 12 });
    v.reeds.push({ id: U.uid('r'), sid: pondA.id, a: 0, b: 3, side: -pondA.inner, size: 3, seed: 13 });
    // a deep fall out of the pool, a small one on the branch, gravel after the fall
    v.falls.push({ id: U.uid('f'), sid: river.id, u: 10, seed: 0.3 });
    v.falls.push({ id: U.uid('f'), sid: branch.id, u: 2, seed: 0.7 });
    v.gravel.push({ id: U.uid('g'), sid: river.id, a: 12, b: 16, seed: 21 });
    // the dam
    v.twigs.push({ id: U.uid('w'), sid: brook.id, u: 1.5, seed: 0.4 });
    v.lanterns = [
      { sid: river.id, u: 0 }, { sid: pondA.id, u: 0 }, { sid: pondB.id, u: 0 },
      { sid: brook.id, u: 1.5, held: true },
    ];
    return v;
  }
  return { make };
})();
