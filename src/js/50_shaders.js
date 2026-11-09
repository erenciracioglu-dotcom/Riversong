/* Riversong — GLSL: painted land, flowing water, ponds, sprites, final light & colour. */
'use strict';
RS.shaders = (() => {
  const common = `
float h21(vec2 p){ p = fract(p*vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*vn(p); p=p*2.03+vec2(17.1,9.3); a*=.5; } return s; }
float fbm3(vec2 p){ float s=0., a=.5; for(int i=0;i<3;i++){ s+=a*vn(p); p=p*2.07+vec2(5.3,11.9); a*=.5; } return s; }
`;
  const fullVS = `#version 300 es
void main(){ vec2 p = vec2((gl_VertexID==1)?3.:-1., (gl_VertexID==2)?3.:-1.); gl_Position = vec4(p,0.,1.); }`;

  // ---------------- land: a watercolour meadow on paper, forest at the edges ----------------
  const landFS = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform vec4 uView; uniform float uSeed; uniform vec2 uWorld; uniform vec3 uSun;
out vec4 o;
${common}
vec2 cellRand(vec2 c){ return vec2(h21(c + uSeed*0.013), h21(c.yx + 7.7 + uSeed*0.017)); }
void main(){
  vec2 css = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uView.w;
  vec2 W = (css - uRes / uView.w * 0.5) / uView.z + uView.xy;
  vec2 S = W + vec2(uSeed*0.37, uSeed*0.21);
  // soft washes of colour
  vec2 warp = vec2(fbm(S/520.), fbm(S/520. + 3.1)) * 1.4;
  float n0 = fbm(S/420. + warp);
  float n1 = fbm(S/230. + warp*0.6 + 9.);
  vec3 fresh = vec3(0.66, 0.74, 0.44), deep = vec3(0.50, 0.63, 0.38), ochre = vec3(0.80, 0.74, 0.50), sage = vec3(0.60, 0.68, 0.54);
  vec3 c = mix(fresh, deep, smoothstep(0.35, 0.7, n0));
  c = mix(c, ochre, smoothstep(0.58, 0.78, n1) * 0.65);
  c = mix(c, sage, smoothstep(0.55, 0.85, fbm(S/150. + 4.)) * 0.35);
  // pigment pools at the edges of each wash
  float e1 = 1. - smoothstep(0.0, 0.012, abs(n0 - 0.52));
  float e2 = 1. - smoothstep(0.0, 0.01, abs(n1 - 0.62));
  c *= 1. - 0.05*e1 - 0.04*e2;
  // brushy grass streaks
  float ang = fbm3(S/300.) * 6.28;
  vec2 r = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * S;
  float strokes = vn(r * vec2(0.025, 0.32));
  c *= 0.975 + 0.035 * strokes;
  // granulation & paper
  c *= 0.955 + 0.06 * vn(S * 0.33) + 0.03 * vn(S * 1.4);
  // tiny meadow flowers
  vec2 fc = floor(S / 13.), ff = fract(S / 13.);
  float fh = h21(fc + 31.);
  if (fh > 0.986) {
    vec2 fp = cellRand(fc) * 0.6 + 0.2;
    float fd = length((ff - fp) * 13.);
    float pick = h21(fc + 5.);
    vec3 fcol = pick < 0.4 ? vec3(0.98,0.96,0.88) : pick < 0.7 ? vec3(0.98,0.86,0.40) : pick < 0.88 ? vec3(0.93,0.66,0.74) : vec3(0.66,0.72,0.95);
    c = mix(c, fcol, (1. - smoothstep(0.7, 2.1, fd)) * 0.62);
  }
  // distance to the paper's edge (deckled)
  float d = min(min(W.x, uWorld.x - W.x), min(W.y, uWorld.y - W.y));
  d += (fbm(W / 45.) - 0.5) * 34. + (vn(W / 6.) - 0.5) * 5.;
  // forest at the edges: round canopies lit by the sun, with shadows
  float forest = smoothstep(200., 40., d) * smoothstep(0.38, 0.62, fbm(S / 160.) + smoothstep(120., 30., d) * 0.4);
  if (forest > 0.01) {
    float cs = 30.;
    vec2 base = floor(W / cs);
    float cover = 0., shadow = 0.; vec3 tc = vec3(0.);
    vec2 sd = normalize(uSun.xy + 1e-4);
    float sh = clamp(0.9 / max(uSun.z, 0.15), 0.6, 3.5);
    for (int j=-1;j<=1;j++) for (int i=-1;i<=1;i++){
      vec2 cell = base + vec2(i,j);
      float present = step(0.25, h21(cell + 91.));
      if (present < 0.5) continue;
      vec2 ctr = (cell + 0.2 + cellRand(cell)*0.6) * cs;
      float rad = cs * (0.55 + 0.4*h21(cell + 3.));
      vec2 q = W - ctr;
      // shadow: canopy displaced away from the sun
      vec2 qs = W - (ctr - sd * rad * 0.55 * sh);
      shadow = max(shadow, 1. - smoothstep(rad*0.75, rad*1.05, length(qs)));
      float rr = length(q) / (rad * (0.92 + 0.12*vn(normalize(q+1e-4)*3. + cell)));
      if (rr < 1.) {
        vec3 nrm = normalize(vec3(q / rad, sqrt(max(0., 1. - rr*rr)) + 0.3));
        float lam = max(0., dot(nrm, normalize(vec3(sd * sqrt(1. - uSun.z*uSun.z), uSun.z))));
        vec3 leaf = mix(vec3(0.20,0.34,0.20), vec3(0.32,0.45,0.22), h21(cell+1.));
        leaf *= 0.62 + 0.62*lam;
        leaf *= 0.9 + 0.2*vn(W*0.35 + cell*3.);
        float edge = smoothstep(0.82, 1., rr);
        leaf *= 1. - 0.25*edge;
        float cv = 1. - smoothstep(0.93, 1., rr);
        if (cv > cover) { cover = cv; tc = leaf; }
      }
    }
    c *= 1. - 0.32 * shadow * forest;
    c = mix(c, tc, cover * forest);
  }
  // paper outside the valley, with a darker rim where the wash dried
  vec3 paper = vec3(0.95, 0.925, 0.86) * (0.97 + 0.04*vn(W*0.5) + 0.02*vn(W*2.1));
  float inside = smoothstep(-2., 4., d);
  c *= 1. - 0.16 * (1. - smoothstep(0., 9., d)) * inside;
  c = mix(paper, c, inside);
  o = vec4(c, 1.);
}`;

  // ---------------- water strips (also used for the wet shore) ----------------
  const stripVS = `#version 300 es
layout(location=0) in vec2 aC; layout(location=1) in vec2 aN; layout(location=2) in float aHW;
layout(location=3) in float aSide; layout(location=4) in float aU; layout(location=5) in float aT; layout(location=6) in float aS;
uniform vec4 uCam; uniform float uExtra; uniform float uWidthMul;
out float vSide; out float vU; out float vT; out float vS; out float vHW; out vec2 vWorld;
void main(){
  float hw = aHW * uWidthMul + uExtra;
  vec2 w = aC + aN * aSide * hw;
  gl_Position = vec4((w.x - uCam.x) * uCam.z, -(w.y - uCam.y) * uCam.w, 0., 1.);
  vSide = aSide; vU = aU; vT = aT; vS = aS; vHW = hw; vWorld = w;
}`;
  const waterFS = `#version 300 es
precision highp float;
in float vSide; in float vU; in float vT; in float vS; in float vHW; in vec2 vWorld;
uniform float uBeat, uTime, uK, uD, uRing, uSeed, uNight, uZoom, uLines, uInner, uSunEl, uGlow;
uniform vec3 uDeep, uShallow;
out vec4 o;
${common}
float fl(float t, float a, float f1, float f2, float sd){ return vn(vec2(t*f1 + sd, a*f2 + sd*0.37)); }
float sm(float t, float a, float f1, float f2, float sd){
  float n = fl(t - uBeat, a, f1, f2, sd);
  if (uRing < 0.5) return n;
  float w = smoothstep(uD - 1., uD, t);
  return mix(n, fl(t - uD - uBeat, a, f1, f2, sd), w);
}
void main(){
  float a = vSide, aa = abs(a);
  bool inner = uRing > 0.5 && a * uInner > 0.;
  float depth = inner ? 1. - aa*aa*0.22 : 1. - aa*aa;
  vec3 c = mix(uShallow, uDeep, smoothstep(0., 1., depth));
  float n1 = sm(vT, a, 2.3, 2.4, uSeed);
  float n2 = sm(vT, a, 5.3, 5.1, uSeed + 13.);
  float streak = smoothstep(0.58, 0.82, n1*0.65 + n2*0.35);
  c += streak * 0.08 * (1. - aa*0.6);
  float rip = sm(vT, a, 9.0, 8.0, uSeed + 7.);
  c *= 0.95 + 0.07 * rip;
  float g = sm(vT, a + sin(uTime*0.8 + vU*1.7)*0.06, 6.5, 7., uSeed + 29.) * sm(vT, a, 11., 13., uSeed + 41.);
  float glint = smoothstep(0.42, 0.62, g) * (0.3 + 0.7*clamp(uSunEl, 0., 1.)) * (1. - aa) * (1. + 0.5*uNight);
  c += glint * mix(vec3(1.0,0.97,0.88), vec3(0.72,0.8,1.0), uNight) * 0.26;
  if (uNight > 0.01) {
    vec2 cell = floor(vWorld/9.); float h = h21(cell + 17.);
    if (h > 0.982) { vec2 f = fract(vWorld/9.) - 0.5; float tw = 0.55 + 0.45*sin(uTime*2.3 + h*80.);
      c += uNight * (1. - smoothstep(0.02, 0.11, length(f))) * tw * 1.3; }
  }
  // faint ripple lines on every beat (and fainter on half beats)
  float bt = vT + aa*aa*0.07;
  float unit = vS * uK * 56.;
  float lw = 0.85 / max(uZoom, 0.3) + 0.45;
  float db = abs(fract(bt + 0.5) - 0.5) * unit;
  float dh = abs(fract(bt*2. + 0.5) - 0.5) * 0.5 * unit;
  float line = (1. - smoothstep(lw*0.5, lw, db)) * uLines;
  float half_ = (1. - smoothstep(lw*0.35, lw*0.75, dh)) * uLines * 0.38;
  c = mix(c, c*1.28 + 0.05, max(line*0.62, half_*0.42) * (1. - aa*0.3));
  float fw = fwidth(a) * 1.4;
  float alpha;
  if (inner) {
    alpha = 1. - smoothstep(0.55, 1.0, aa);
  } else {
    c *= mix(1., 0.8, smoothstep(0.72, 1., aa));
    float foam = smoothstep(0.82, 0.93, aa) * (1. - smoothstep(0.95, 1.0, aa)) * (0.4 + 0.6*n2);
    c += foam * 0.1;
    alpha = 1. - smoothstep(1. - fw, 1., aa);
  }
  c += uGlow * vec3(0.10, 0.08, 0.03) * (1. - aa);
  o = vec4(c, alpha);
}`;
  const shoreFS = `#version 300 es
precision highp float;
in float vSide; in float vU; in float vT; in float vS; in float vHW; in vec2 vWorld;
uniform float uExtra;
out vec4 o;
${common}
void main(){
  float d = abs(vSide) * vHW;
  float hw0 = vHW - uExtra;
  float t = clamp((d - hw0) / uExtra, 0., 1.);
  float alpha = (1. - smoothstep(0., 1., t)) * 0.4 * (0.7 + 0.3*vn(vWorld*0.17));
  o = vec4(vec3(0.30, 0.29, 0.18), alpha);
}`;
  // ---------------- pond interior: calm water slowly circling ----------------
  const posVS = `#version 300 es
layout(location=0) in vec2 aP;
uniform vec4 uCam;
out vec2 vWorld;
void main(){ vWorld = aP; gl_Position = vec4((aP.x - uCam.x) * uCam.z, -(aP.y - uCam.y) * uCam.w, 0., 1.); }`;
  const pondFS = `#version 300 es
precision highp float;
in vec2 vWorld;
uniform vec2 uC; uniform float uD, uBeat, uDir, uSeed, uNight, uTime, uSunEl;
uniform vec3 uDeep, uShallow;
out vec4 o;
${common}
void main(){
  vec2 p = vWorld - uC; float r = length(p); float th = atan(p.y, p.x);
  float rot = uDir * uBeat / uD * 6.2831853;
  float th2 = th - rot;
  vec2 q = vec2(cos(th2), sin(th2)) * r;
  float n = vn(q*0.045 + uSeed) * 0.6 + vn(q*0.11 + 3.) * 0.4;
  float n2 = vn(q*0.02 + 9.);
  vec3 c = mix(uDeep, uShallow, 0.18 + 0.2*n2);
  c += smoothstep(0.62, 0.86, n) * 0.06;
  float g = vn(q*0.16 + vec2(uTime*0.08, 0.)) * vn(q*0.37 - vec2(0., uTime*0.11) + 5.);
  c += smoothstep(0.46, 0.66, g) * (0.25 + 0.6*clamp(uSunEl,0.,1.)) * (1. + 0.3*uNight) * mix(vec3(1.,.97,.88), vec3(.72,.8,1.), uNight) * 0.14;
  if (uNight > 0.01) {
    vec2 cell = floor(vWorld/9.); float h = h21(cell + 17.);
    if (h > 0.982) { vec2 f = fract(vWorld/9.) - 0.5; float tw = 0.55 + 0.45*sin(uTime*2.3 + h*80.);
      c += uNight * (1. - smoothstep(0.02, 0.11, length(f))) * tw * 1.3; }
  }
  o = vec4(c, 1.);
}`;
  const flatFS = `#version 300 es
precision highp float;
out vec4 o;
void main(){ o = vec4(0.); }`;

  // ---------------- sprites: everything that sits on the land or water ----------------
  const spriteVS = `#version 300 es
layout(location=0) in vec2 aPos; layout(location=1) in vec2 aHalf; layout(location=2) in float aRot; layout(location=3) in float aKind;
layout(location=4) in vec4 aP; layout(location=5) in vec4 aCol;
uniform vec4 uCam;
out vec2 vUV; flat out int vKind; out vec4 vP; out vec4 vCol; out vec2 vWorld; flat out float vRot;
void main(){
  vec2 c = vec2((gl_VertexID & 1) == 1 ? 1. : -1., (gl_VertexID & 2) == 2 ? 1. : -1.);
  float cs = cos(aRot), sn = sin(aRot);
  vec2 l = c * aHalf;
  vec2 w = aPos + vec2(l.x*cs - l.y*sn, l.x*sn + l.y*cs);
  gl_Position = vec4((w.x - uCam.x) * uCam.z, -(w.y - uCam.y) * uCam.w, 0., 1.);
  vUV = c; vKind = int(aKind + 0.5); vP = aP; vCol = aCol; vWorld = w; vRot = aRot;
}`;
  const spriteFS = `#version 300 es
precision highp float;
in vec2 vUV; flat in int vKind; in vec4 vP; in vec4 vCol; in vec2 vWorld; flat in float vRot;
uniform vec3 uSun; uniform float uTime; uniform float uAdd;
out vec4 o;
${common}
float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return length(pa-ba*h); }
vec2 toLocal(vec2 v){ float c=cos(-vRot), s=sin(-vRot); return vec2(v.x*c - v.y*s, v.x*s + v.y*c); }
vec3 sunL(){ vec2 sd = toLocal(normalize(uSun.xy + 1e-5)); float el = clamp(uSun.z, 0.08, 1.); return normalize(vec3(sd*sqrt(1.-el*el), el)); }
void outp(vec3 c, float a){ if (uAdd > 0.5) o = vec4(c*a, a); else o = vec4(c, a); }
void main(){
  vec2 uv = vUV; vec4 col = vCol;
  if (vKind == 0 || vKind == 12) { // stone (12: flat marker stone)
    float s = vP.x;
    float ang = atan(uv.y, uv.x);
    float R = 0.86 + 0.07*sin(3.*ang + s*6.283) + 0.045*sin(5.*ang + s*17.) + 0.025*sin(8.*ang + s*31.);
    float d = length(uv) / R;
    float fw = fwidth(d) * 1.3;
    float a = 1. - smoothstep(1. - fw, 1., d);
    if (a <= 0.001) discard;
    float flatness = vKind == 12 ? 0.35 : 1.0;
    vec3 n = normalize(vec3(uv / R * 1.05, (sqrt(max(0., 1. - d*d)) * 0.9 + 0.15) / flatness));
    float lam = max(0., dot(n, sunL()));
    vec3 base = mix(vec3(0.60,0.58,0.55), vec3(0.68,0.60,0.48), fract(s*3.7));
    base = mix(base, vec3(0.50,0.52,0.55), fract(s*7.3) * 0.5);
    base *= 0.86 + 0.22 * vn(uv*5. + s*40.);
    float wet = vP.z;
    base *= mix(1., 0.8, wet);
    vec3 c = base * (0.48 + 0.72*lam);
    vec3 H = normalize(sunL() + vec3(0,0,1));
    c += wet * pow(max(0., dot(n, H)), 36.) * 0.38;
    c *= mix(1., 0.62, smoothstep(0.76, 1., d));
    c = mix(c, c*vec3(1.22,1.1,0.9) + vec3(0.13,0.10,0.04), clamp(vP.y, 0., 1.));
    if (vKind == 12) { float dot_ = 1. - smoothstep(0.16, 0.24, length(uv)); c = mix(c, c*0.6, dot_); }
    outp(c, a * col.a); return;
  }
  if (vKind == 1) { // reed blade: x from base (-1) to tip (1)
    float x = uv.x*0.5 + 0.5;
    float w = ((1. - pow(x, 1.5)) * 0.88 + 0.06) * vP.w;
    float d = abs(uv.y) / w;
    float fw = fwidth(uv.y) / w * 1.5;
    float a = (1. - smoothstep(1. - fw, 1., d)) * (1. - smoothstep(0.97, 1., x));
    vec3 c = mix(col.rgb*0.55, col.rgb*1.12, x);
    c *= 0.92 + 0.14 * step(0., uv.y);
    if (vP.z > 0.5) {
      float hd = length(vec2((x - 0.76) / 0.13, uv.y / 0.7));
      float head = 1. - smoothstep(0.85, 1.0, hd);
      c = mix(c, vec3(0.30,0.21,0.13) * (0.8 + 0.3*vn(uv*9.)), head);
      a = max(a, head);
    }
    c = mix(c, c + vec3(0.30,0.24,0.06), clamp(vP.y, 0., 1.));
    if (a <= 0.001) discard;
    outp(c, a * col.a); return;
  }
  if (vKind == 2) { // twig
    float s = vP.x;
    float d1 = sdSeg(uv, vec2(-0.96, 0.06*sin(s*9.)), vec2(0.96, -0.06*cos(s*7.))) - 0.2*(1. - 0.3*abs(uv.x));
    float d2 = sdSeg(uv, vec2(-0.25 + 0.2*s, 0.), vec2(0.1 + 0.2*s, 0.78)) - 0.085;
    float d3 = sdSeg(uv, vec2(0.38 - 0.2*s, 0.), vec2(0.66, -0.72)) - 0.075;
    float d = min(d1, min(d2, d3));
    float fw = fwidth(d) * 1.5;
    float a = 1. - smoothstep(-fw, fw, d);
    if (a <= 0.001) discard;
    vec3 c = vec3(0.45,0.32,0.19) * (0.72 + 0.38*vn(vec2(uv.x*16., uv.y*3.) + s*20.));
    c *= 0.82 + 0.3*clamp(-d*5., 0., 1.);
    outp(c, a * col.a); return;
  }
  if (vKind == 3) { // floating paper lantern on a little raft
    float r = length(uv);
    vec2 q = abs(uv) - vec2(0.5); float raft = length(max(q,0.)) + min(max(q.x,q.y),0.) - 0.32;
    float fw = fwidth(r) * 1.5;
    float aRaft = 1. - smoothstep(-fw, fw, raft);
    float aBody = 1. - smoothstep(0.76 - fw, 0.76, r);
    vec3 c = vec3(0.30,0.20,0.12) * (0.8 + 0.3*vn(uv*7.));
    vec3 paper = mix(vec3(1.,0.93,0.72), vec3(0.95,0.5,0.22), smoothstep(0.08, 0.76, r));
    paper *= 1. - 0.12*smoothstep(0.03, 0., abs(r - 0.42)) - 0.1*smoothstep(0.03, 0., abs(r - 0.62));
    float rim = smoothstep(0.66, 0.76, r); paper *= 1. - 0.25*rim;
    paper = mix(paper, vec3(0.42,0.24,0.12), smoothstep(0.03, 0., abs(r - 0.2)) * 0.8);
    paper = mix(paper, vec3(1.,0.99,0.9), 1. - smoothstep(0.1, 0.17, r));
    c = mix(c, paper * (0.85 + vP.y*0.4), aBody);
    float a = max(aRaft, aBody);
    if (a <= 0.001) discard;
    outp(c, a * col.a); return;
  }
  if (vKind == 4) { // soft shadow
    float a = (1. - smoothstep(0.25, 1., length(uv))) * col.a;
    outp(col.rgb, a); return;
  }
  if (vKind == 5) { // gravel grain
    float s = vP.x;
    float d = length(uv * vec2(1., 1.25 + 0.4*s));
    float fw = fwidth(d) * 1.3;
    float a = 1. - smoothstep(1. - fw, 1., d);
    if (a <= 0.001) discard;
    vec3 n = normalize(vec3(uv, sqrt(max(0.,1.-d*d)) + 0.3));
    float lam = max(0., dot(n, sunL()));
    vec3 c = col.rgb * (0.55 + 0.65*lam) * mix(1., 0.7, smoothstep(0.7, 1., d));
    outp(c, a * col.a); return;
  }
  if (vKind == 6) { // soft dot (spray, mist, drops)
    float r = length(uv);
    float a = pow(max(0., 1. - r), vP.x > 0. ? vP.x : 1.6) * col.a;
    if (a <= 0.002) discard;
    outp(col.rgb, a); return;
  }
  if (vKind == 7) { // ripple ring
    float r = length(uv);
    float t = vP.x;
    float a = (1. - smoothstep(0., t, abs(r - (1. - t)))) * col.a;
    a *= 0.75 + 0.25*vn(normalize(uv + 1e-4)*4. + vP.y);
    if (a <= 0.002) discard;
    outp(col.rgb, a); return;
  }
  if (vKind == 8) { // foam below a waterfall: x across the stream, y downstream
    float n = vn(vec2(uv.x*3.5, uv.y*2.2 - uTime*vP.y));
    float n2 = vn(vec2(uv.x*7.1 + 3., uv.y*4.3 - uTime*vP.y*1.6));
    float m = smoothstep(0.45, 0.8, n*0.6 + n2*0.4);
    float a = m * (1. - smoothstep(0.55, 1., abs(uv.x))) * (1. - smoothstep(-0.2, 1., uv.y)) * col.a;
    a += (1. - smoothstep(0.0, 0.2, abs(uv.y + 0.85))) * (1. - smoothstep(0.6, 1., abs(uv.x))) * 0.7 * col.a;
    if (a <= 0.002) discard;
    outp(col.rgb, clamp(a, 0., 1.)); return;
  }
  if (vKind == 9) { // halo (glow)
    float r = length(uv);
    float a = pow(max(0., 1. - r), vP.x > 0. ? vP.x : 2.2) * col.a;
    if (a <= 0.002) discard;
    outp(col.rgb, a); return;
  }
  if (vKind == 10) { // firefly
    float r = length(uv);
    float a = (pow(max(0., 1. - r), 3.) * 0.6 + (1. - smoothstep(0.05, 0.14, r))) * col.a;
    if (a <= 0.002) discard;
    outp(col.rgb, a); return;
  }
  if (vKind == 11) { // soft line (x along, y across); vP.x: fade toward +x end
    float a = (1. - smoothstep(0.25, 1., abs(uv.y))) * (1. - smoothstep(0.8, 1., abs(uv.x)));
    a *= mix(1., 0.5 - 0.5*uv.x, vP.x);
    if (vP.y > 0.) a *= 0.55 + 0.45*sin(uv.x*vP.y - uTime*6.);
    a *= col.a;
    if (a <= 0.002) discard;
    outp(col.rgb, a); return;
  }
  if (vKind == 13) { // cloud shadow
    float r = length(uv) + (vn(uv*2.2 + vP.x + uTime*0.05) - 0.5) * 0.35;
    float a = (1. - smoothstep(0.35, 1., r)) * col.a;
    if (a <= 0.002) discard;
    outp(col.rgb, a); return;
  }
  discard;
}`;

  // ---------------- final: day light, lantern light, mist, paper ----------------
  const compFS = `#version 300 es
precision highp float;
uniform sampler2D uScene; uniform vec2 uRes;
uniform vec3 uAmb; uniform float uSat; uniform vec3 uTint; uniform float uMist; uniform float uTime; uniform float uNight;
uniform int uNL; uniform vec4 uL[24]; uniform vec3 uLC[24];
uniform vec2 uMistOff;
out vec4 o;
${common}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 c = texture(uScene, uv).rgb;
  vec3 L = uAmb;
  for (int i = 0; i < 24; i++) {
    if (i >= uNL) break;
    vec2 d = gl_FragCoord.xy - uL[i].xy;
    float f = max(0., 1. - length(d) / uL[i].z);
    L += uLC[i] * uL[i].w * f * f * (3. - 2.*f);
  }
  c *= L;
  float g = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(g), c, uSat) * uTint;
  if (uMist > 0.001) {
    vec2 p = gl_FragCoord.xy / 260. + uMistOff;
    float m = fbm3(p) * 0.7 + fbm3(p*2.3 + 7.) * 0.3;
    c = mix(c, vec3(0.93, 0.92, 0.97), smoothstep(0.35, 0.85, m) * uMist);
  }
  vec2 q = uv - 0.5;
  c *= 1. - dot(q, q) * (0.42 + uNight * 0.45);
  c *= 0.985 + 0.03 * h21(gl_FragCoord.xy * 0.37 + fract(uTime * 0.0));
  o = vec4(c, 1.);
}`;
  const copyFS = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uRes;
out vec4 o;
void main(){ o = texture(uTex, gl_FragCoord.xy / uRes); }`;

  return { fullVS, landFS, stripVS, waterFS, shoreFS, posVS, pondFS, flatFS, spriteVS, spriteFS, compFS, copyFS };
})();
