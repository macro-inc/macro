/** GLSL for the portrait. Lighting is in view space: lights stay fixed to the frame while the head turns. */

const LIGHTS = /* glsl */ `
uniform vec3 uKeyDir; uniform vec3 uKeyCol; uniform vec3 uFillDir; uniform vec3 uFillCol;
uniform vec3 uRimDir; uniform vec3 uRimCol; uniform vec3 uSky; uniform vec3 uGround;
vec3 shade(vec3 albedo, vec3 N, vec3 V, float spec, float gloss, float ao, float wrap) {
  float key = max((dot(N, uKeyDir) + wrap) / (1.0 + wrap), 0.0);
  vec3 c = albedo * (mix(uGround, uSky, N.y * 0.5 + 0.5) * ao
    + uKeyCol * key * mix(0.55, 1.0, ao)
    + uFillCol * max(dot(N, uFillDir) * 0.5 + 0.5, 0.0) * ao);
  float edge = pow(1.0 - max(dot(N, V), 0.0), 3.0) * max(dot(N, uRimDir) * 0.5 + 0.5, 0.0);
  c += uRimCol * edge * (0.25 + albedo);
  c += uKeyCol * spec * pow(max(dot(N, normalize(uKeyDir + V)), 0.0), gloss) * key;
  return c;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float ell(vec2 p, vec2 c, vec2 r) { return 1.0 - smoothstep(0.7, 1.0, length((p - c) / r)); }
`;

export const skinVertex = /* glsl */ `
attribute vec3 aBase; attribute float aAO; attribute float aScalp; attribute float aBeard;
varying vec3 vN; varying vec3 vView; varying vec3 vBase; varying vec2 vUv;
varying float vAO; varying float vScalp; varying float vBeard;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz; vN = normalMatrix * normal; vBase = aBase; vUv = uv;
  vAO = aAO; vScalp = aScalp; vBeard = aBeard;
  gl_Position = projectionMatrix * mv;
}`;

export const skinFragment = /* glsl */ `
${LIGHTS}
uniform sampler2D tColor; uniform sampler2D tNormal; uniform sampler2D tSpec;
uniform vec3 uTone; uniform vec3 uAvg; uniform vec3 uHair; uniform vec3 uIris;
uniform float uFlush; uniform float uFreckles; uniform float uAge; uniform float uStubble; uniform float uClean;
uniform float uScalp; uniform float uBrow; uniform float uBrowCut; uniform float uMark;
uniform float uEyeBright; uniform float uOpen; uniform float uSlope; uniform float uCx;
varying vec3 vN; varying vec3 vView; varying vec3 vBase; varying vec2 vUv;
varying float vAO; varying float vScalp; varying float vBeard;

float segment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
float beardArea(vec2 px) {
  return ell(px, vec2(512.0, 592.0), vec2(215.0, 235.0))
    * smoothstep(430.0, 446.0, px.y + max(0.0, abs(px.x - 512.0) - 95.0) * 0.9)
    * (1.0 - ell(px, vec2(512.0, 479.0), vec2(60.0, 19.0)));
}
// One eye painted on the scan's closed lid, in the scan's own coordinates. inner is +1 when the nose is toward +x.
vec4 eye(vec2 centre, float inner) {
  const float hw = 0.31;
  vec2 d = vBase.xy - centre;
  float ax = clamp(d.x / hw, -1.0, 1.0);
  float mid = -uSlope * d.x * inner;
  float span = pow(max(1.0 - ax * ax, 0.0), 0.6);
  float up = mid + hw * 0.4 * uOpen * span;
  float low = mid - hw * 0.24 * uOpen * span;
  float inside = step(abs(d.x), hw) * step(low, d.y) * step(d.y, up) * step(1.3, vBase.z);
  vec2 c = vec2(0.0, mid + hw * 0.05);
  float r = length(d - c) / (hw * 0.45);
  vec3 sclera = vec3(0.74, 0.70, 0.66) * (0.7 + 0.3 * span) * mix(0.85, 1.1, clamp(uEyeBright - 0.75, 0.0, 0.6) / 0.6);
  vec3 iris = uIris * uEyeBright * (0.6 + 0.9 * smoothstep(1.0, 0.35, r));
  iris = mix(iris, vec3(0.012), smoothstep(0.46, 0.36, r));
  vec3 ball = mix(iris, sclera, smoothstep(0.9, 1.02, r));
  ball += vec3(0.85) * uEyeBright * step(length(d - c - vec2(0.045, 0.05)), hw * 0.085);
  ball *= mix(0.5, 1.0, smoothstep(up, up - hw * 0.16, d.y));
  return vec4(ball, inside);
}
void main() {
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * 1024.0;
  vec3 tex = texture2D(tColor, vUv).rgb;
  float lum = dot(tex, vec3(0.3, 0.6, 0.1)) / dot(uAvg, vec3(0.3, 0.6, 0.1));
  vec3 col = tex / uAvg * uTone;

  // Beard area: lift the scan's baked stubble for a clean face, or grow it in the hair colour.
  float grain = hash(floor(px * 0.9));
  col = mix(col, uTone * mix(1.0, lum, 0.5), uClean * beardArea(px) * 0.75);
  col = mix(col, uHair * 0.7, vBeard * uStubble * (0.55 + 0.45 * grain));
  // Hair roots on the scalp, under the hair shell.
  col = mix(col, uHair * 0.6, vScalp * uScalp);
  // Brows: the scan's own, recoloured, heavier or lighter, with an optional gap.
  float browArea = max(ell(px, vec2(440.0, 266.0), vec2(86.0, 30.0)), ell(px, vec2(588.0, 266.0), vec2(86.0, 30.0)));
  float dark = smoothstep(0.82 + 0.1 * (uBrow - 1.0), 0.5, lum) * browArea;
  dark *= 1.0 - uBrowCut * (1.0 - smoothstep(2.5, 5.0, abs(px.x - 606.0 + (px.y - 266.0) * 0.4)));
  col = mix(col, mix(uTone * lum, uHair * 0.5, clamp(uBrow, 0.0, 1.0)), dark * min(uBrow + 0.2, 1.0));

  // Flush on cheeks, nose and ears.
  vec3 q = vec3(abs(vBase.x - uCx), vBase.yz);
  float warm = exp(-dot(q - vec3(0.95, 0.95, 1.7), q - vec3(0.95, 0.95, 1.7)) / 0.2)
    + 0.6 * exp(-dot(q - vec3(0.0, 1.0, 2.5), q - vec3(0.0, 1.0, 2.5)) / 0.08)
    + 0.5 * exp(-dot(q - vec3(1.7, 1.4, 0.0), q - vec3(1.7, 1.4, 0.0)) / 0.2);
  col *= mix(vec3(1.0), vec3(1.2, 0.8, 0.78), clamp(uFlush * warm, 0.0, 1.0));

  // Freckles across the cheeks and the bridge of the nose.
  vec2 cell = floor(px / 7.0);
  vec2 centre = (cell + 0.25 + 0.5 * vec2(hash(cell), hash(cell + 17.0))) * 7.0;
  float freckleArea = ell(px, vec2(512.0, 372.0), vec2(190.0, 78.0));
  float freckle = step(hash(cell + 5.0), uFreckles) * (1.0 - smoothstep(1.4, 3.2, length(px - centre))) * freckleArea;
  col = mix(col, col * vec3(0.55, 0.4, 0.32), freckle * 0.85);

  // Accent: cheek scar, beauty mark.
  if (uMark > 0.5 && uMark < 1.5) {
    float s = 1.0 - smoothstep(1.2, 3.0, segment(px, vec2(596.0, 392.0), vec2(634.0, 446.0)));
    col = mix(col, col * vec3(1.35, 1.05, 1.0) + 0.04, s);
  }
  if (uMark > 1.5 && uMark < 2.5) col = mix(col, uHair * 0.3 + vec3(0.03, 0.015, 0.01), 1.0 - smoothstep(3.0, 5.0, length(px - vec2(418.0, 452.0))));

  // Surface: scan normal map, deeper with age; pores and lines darken the skin.
  vec3 N = normalize(vN);
  vec3 V = normalize(vView);
  vec3 mapN = texture2D(tNormal, vUv).xyz * 2.0 - 1.0;
  mapN.xy *= 0.5 + 1.4 * uAge;
  vec3 q0 = dFdx(-vView), q1 = dFdy(-vView);
  vec2 st0 = dFdx(vUv), st1 = dFdy(vUv);
  vec3 S = q0 * st1.t - q1 * st0.t, T = -q0 * st1.s + q1 * st0.s;
  if (dot(S, S) > 1e-12 && dot(T, T) > 1e-12) N = normalize(mat3(normalize(S), normalize(T), N) * normalize(mapN));
  float cavity = 1.0 - normalize(mapN).z;
  col *= 1.0 - clamp(cavity * (0.6 + 2.6 * uAge), 0.0, 0.5);
  col = mix(col, vec3(dot(col, vec3(0.3, 0.6, 0.1))), 0.12 * uAge);

  float spec = texture2D(tSpec, vUv).r * 0.35 * (1.0 - vScalp * uScalp);
  vec3 lit = shade(col, N, V, spec, 18.0, vAO, 0.35);

  vec4 left = eye(vec2(-0.73, 1.655), 1.0);
  vec4 right = eye(vec2(0.56, 1.655), -1.0);
  vec4 e = left.a > right.a ? left : right;
  vec3 flat_ = normalize(vN);
  vec3 eyeLit = shade(e.rgb, flat_, V, 0.0, 1.0, 1.0, 0.8) + e.rgb * 0.12;
  lit = mix(lit, eyeLit, e.a);
  gl_FragColor = vec4(lit, mix(0.22, 0.02, e.a));
}`;

export const propVertex = /* glsl */ `
attribute vec3 aBase; attribute float aDepth;
varying vec3 vN; varying vec3 vView; varying vec3 vBase; varying float vDepth;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz; vN = normalMatrix * normal; vBase = aBase; vDepth = aDepth;
  gl_Position = projectionMatrix * mv;
}`;

/** Hair, beard, clothes, eyewear and earpieces. uKind: 0 plain, 1 strands, 2 cloth. */
export const propFragment = /* glsl */ `
${LIGHTS}
uniform vec3 uColor; uniform float uKind; uniform float uGloss; uniform float uSpec; uniform float uWeight;
uniform float uScreen; uniform float uGlow; uniform float uDepthScale;
varying vec3 vN; varying vec3 vView; varying vec3 vBase; varying float vDepth;
void main() {
  if (uScreen < 1.0) {
    // Screen-door transparency on the pixel grid, in place of blending.
    vec2 g = mod(floor(gl_FragCoord.xy), 2.0);
    if ((g.x + g.y * 2.0 + 0.5) / 4.0 > uScreen) discard;
  }
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(vView);
  vec3 col = uColor;
  float ao = 1.0;
  if (uKind > 0.5 && uKind < 1.5) {
    float strand = hash(floor(vec2(vBase.x * 9.0 + vBase.z * 4.0, vBase.y * 2.0)));
    col *= 0.7 + 0.6 * strand;
    ao = mix(0.5, 1.0, smoothstep(0.0, 1.0, vDepth * uDepthScale));
  }
  if (uKind > 1.5) ao = mix(0.72, 1.0, smoothstep(0.0, 1.0, vDepth * uDepthScale));
  vec3 lit = shade(col, N, V, uSpec, uGloss, ao, uKind > 0.5 ? 0.25 : 0.0) + uColor * uGlow;
  gl_FragColor = vec4(lit, uWeight);
}`;

export const postVertex = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/**
 * The pixel pass. One scene texel per cell; colours snap to a few levels with a 4x4 ordered dither.
 * The scene's alpha says how hard: eyes and skin stay fine, hair, cloth and the backdrop dither coarsely.
 */
export const postFragment = /* glsl */ `
uniform sampler2D tScene; uniform vec2 uGrid; uniform float uCell; uniform float uCoarse;
uniform vec3 uGlowCol; uniform vec2 uOrigin;
float bayer(vec2 p) {
  int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0));
  int i = x + y * 4;
  float m[16];
  m[0] = 0.0; m[1] = 8.0; m[2] = 2.0; m[3] = 10.0; m[4] = 12.0; m[5] = 4.0; m[6] = 14.0; m[7] = 6.0;
  m[8] = 3.0; m[9] = 11.0; m[10] = 1.0; m[11] = 9.0; m[12] = 15.0; m[13] = 7.0; m[14] = 13.0; m[15] = 5.0;
  return (m[i] + 0.5) / 16.0;
}
void main() {
  vec2 cell = floor((gl_FragCoord.xy - uOrigin) / uCell);
  vec2 block = floor(cell / uCoarse) * uCoarse + floor(uCoarse * 0.5);
  vec2 uv = (min(block, uGrid - 1.0) + 0.5) / uGrid;
  vec4 s = texture2D(tScene, uv);
  vec3 c = 1.0 - exp(-1.55 * s.rgb);
  c = pow(c, vec3(1.0 / 2.2));
  float weight = s.a;
  if (s.a == 0.0) {
    // Backdrop: a low ember glow behind the shoulders, falling to ink.
    vec2 p = uv - vec2(0.5, 0.3);
    float glow = exp(-dot(p * vec2(1.0, 1.25), p * vec2(1.0, 1.25)) * 5.5);
    c = vec3(0.008) + uGlowCol * glow;
    weight = 1.0;
  }
  float levels = mix(30.0, 7.0, weight);
  float amount = mix(0.3, 1.0, weight);
  c = floor(c * levels + 0.5 + (bayer(floor(cell / uCoarse)) - 0.5) * amount) / levels;
  gl_FragColor = vec4(c, 1.0);
}`;
