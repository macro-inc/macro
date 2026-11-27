/**
 * The head scan as an editable mesh: named morph channels (Gaussian pushes around landmarks, the
 * technique the original Macro Bots scene uses), welded normals, and shells grown from the surface
 * for hair, beard and clothes. All masks read the unmorphed scan, so they stay registered.
 */
import type { Scan } from './glb';
import type { MorphKey, RenderState } from './resolve';

/** The scan is a little off-centre. */
export const CX = -0.09;

type Anchor = [
  x: number,
  y: number,
  z: number,
  radius: number,
  dx: number,
  dy: number,
  dz: number,
  mirror?: 0 | 1,
];

// Each push is [centre relative to CX, radius, direction]; mirrored unless the last entry is 0.
const CHANNELS: Record<MorphKey, Anchor[]> = {
  faceWidth: [
    [-1.45, 2.4, 0.3, 0.9, -0.16, 0, 0],
    [-1.1, 1.1, 1.1, 0.7, -0.13, 0, 0],
    [-1.0, 0.2, 1.0, 0.55, -0.08, 0, 0],
  ],
  jawDef: [
    [-1.15, 0.1, 0.9, 0.55, -0.17, -0.02, 0],
    [0, -0.35, 2.15, 0.42, 0, -0.12, 0.1, 0],
    [-0.38, -0.3, 2.0, 0.3, -0.09, 0, 0.02],
  ],
  cheekHigh: [[-0.95, 1.3, 1.55, 0.38, -0.12, 0.05, 0.1]],
  cheekFull: [[-0.8, 0.55, 1.55, 0.5, -0.12, 0, 0.07]],
  noseWide: [
    [-0.32, 0.88, 2.15, 0.2, -0.1, 0, 0],
    [-0.2, 1.5, 2.05, 0.2, -0.06, 0, 0],
  ],
  noseLen: [[0, 1.05, 2.55, 0.3, 0, -0.06, 0.2, 0]],
  tipUp: [[0, 0.95, 2.55, 0.2, 0, 0.11, -0.03, 0]],
  hump: [
    [0, 1.5, 2.2, 0.22, 0, 0, 0.13, 0],
    [0, 0.98, 2.55, 0.16, 0, -0.07, 0, 0],
  ],
  tipRound: [
    [0, 1.0, 2.55, 0.2, 0, 0, -0.07, 0],
    [-0.3, 0.9, 2.2, 0.18, -0.05, 0, 0.03],
  ],
  tipSharp: [[0, 1.0, 2.55, 0.14, 0, 0, 0.07, 0]],
  eyeTilt: [
    [-0.95, 1.66, 1.75, 0.17, 0, 0.07, 0],
    [-0.36, 1.62, 1.95, 0.14, 0, -0.04, 0],
  ],
  browWide: [[-0.55, 2.0, 2.0, 0.3, -0.08, 0, 0]],
  browArch: [[-0.75, 2.05, 1.9, 0.2, 0, 0.09, 0]],
  browFlat: [
    [-0.35, 2.0, 2.05, 0.18, 0, 0.04, 0],
    [-0.95, 2.0, 1.8, 0.18, 0, 0.03, 0],
    [-0.65, 2.08, 1.95, 0.16, 0, -0.03, 0],
  ],
  browRidge: [[-0.42, 2.05, 2.05, 0.33, 0, 0.01, 0.11]],
  browOuterUp: [[-1.0, 2.0, 1.75, 0.2, 0, 0.09, 0]],
  browFurrow: [[-0.3, 2.0, 2.08, 0.2, 0.06, -0.06, 0.02]],
  smile: [
    [-0.44, 0.39, 2.05, 0.22, -0.07, 0.09, -0.03],
    [-0.85, 0.95, 1.75, 0.35, -0.02, 0.06, 0.05],
  ],
  smirk: [
    [0.44, 0.39, 2.05, 0.22, 0.07, 0.1, -0.03, 0],
    [0.85, 0.95, 1.75, 0.3, 0.02, 0.05, 0.04, 0],
  ],
  lipsFull: [[0, 0.34, 2.06, 0.22, 0, 0, 0.1, 0]],
  neckWide: [[-1.0, -0.8, -0.2, 0.6, -0.13, 0, 0]],
  forehead: [[0, 3.0, 1.85, 0.6, 0, 0.04, 0.14, 0]],
  ageSag: [
    [-0.75, 0.2, 1.7, 0.4, -0.03, -0.07, 0],
    [-0.6, 1.45, 1.9, 0.2, 0, -0.03, -0.03],
  ],
};

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const ell = (
  px: number,
  py: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number
) => 1 - smooth(0.7, 1, Math.hypot((px - cx) / rx, (py - cy) / ry));

/** Front factor: 1 facing the camera, -1 at the back of the head. */
const facing = (x: number, z: number, zOrigin: number) => {
  const dx = x - CX;
  const dz = z - zOrigin;
  return dz / Math.max(Math.hypot(dx, dz), 1e-3);
};
function hairline(x: number, z: number) {
  const c = facing(x, z, 0.3);
  return c > 0 ? 2.05 + 0.95 * c ** 1.6 : 2.05 - 1.55 * (-c) ** 0.8;
}
const earMask = (x: number, y: number, z: number) =>
  1 -
  smooth(
    0.8,
    1.2,
    Math.hypot(
      (Math.abs(x - CX) - 1.45) / 0.35,
      (y - 1.45) / 0.65,
      (z - 0.25) / 0.6
    )
  );
/** Beard area in texture pixels (1024 space), after the original scene's mask. */
function beardMask(px: number, py: number) {
  let m = ell(px, py, 512, 592, 215, 235);
  m *= smooth(430, 446, py + Math.max(0, Math.abs(px - 512) - 95) * 0.9);
  return m * (1 - ell(px, py, 512, 479, 60, 19));
}

type Sparse = { index: Uint32Array; delta: Float32Array };

export type Head = ReturnType<typeof createHead>;

export function createHead(scan: Scan) {
  const base = scan.position;
  const count = base.length / 3;
  const position = base.slice();
  const normal = scan.normal.slice();

  // Vertices at the same place share one normal.
  const group = new Uint32Array(count);
  let groups = 0;
  {
    const seen = new Map<string, number>();
    for (let i = 0; i < count; i++) {
      const key = `${Math.round(base[i * 3] * 1e4)},${Math.round(base[i * 3 + 1] * 1e4)},${Math.round(base[i * 3 + 2] * 1e4)}`;
      let g = seen.get(key);
      if (g === undefined) {
        g = groups++;
        seen.set(key, g);
      }
      group[i] = g;
    }
  }

  const channels = {} as Record<MorphKey, Sparse>;
  for (const [key, anchors] of Object.entries(CHANNELS) as [
    MorphKey,
    Anchor[],
  ][]) {
    const all: Anchor[] = [];
    for (const a of anchors) {
      all.push(a);
      if (a[7] !== 0) all.push([-a[0], a[1], a[2], a[3], -a[4], a[5], a[6]]);
    }
    const index: number[] = [];
    const delta: number[] = [];
    for (let i = 0; i < count; i++) {
      let dx = 0,
        dy = 0,
        dz = 0;
      for (const a of all) {
        const d2 =
          (base[i * 3] - CX - a[0]) ** 2 +
          (base[i * 3 + 1] - a[1]) ** 2 +
          (base[i * 3 + 2] - a[2]) ** 2;
        const w = Math.exp(-d2 / (2 * a[3] * a[3]));
        if (w < 1e-3) continue;
        dx += a[4] * w;
        dy += a[5] * w;
        dz += a[6] * w;
      }
      if (dx || dy || dz) {
        index.push(i);
        delta.push(dx, dy, dz);
      }
    }
    channels[key] = {
      index: Uint32Array.from(index),
      delta: Float32Array.from(delta),
    };
  }

  // Static masks.
  const scalp = new Float32Array(count);
  const front = new Float32Array(count);
  const beardAll = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = base[i * 3],
      y = base[i * 3 + 1],
      z = base[i * 3 + 2];
    scalp[i] = smooth(-0.04, 0.14, y - hairline(x, z)) * (1 - earMask(x, y, z));
    front[i] = facing(x, z, 0.3);
    beardAll[i] =
      y < 1.0 && z > 0
        ? beardMask(scan.uv[i * 2] * 1024, (1 - scan.uv[i * 2 + 1]) * 1024)
        : 0;
  }

  const accumulate = new Float32Array(groups * 3);
  function deform(weights: Record<MorphKey, number>) {
    position.set(base);
    for (const key of Object.keys(channels) as MorphKey[]) {
      const w = weights[key];
      if (!w) continue;
      const { index, delta } = channels[key];
      for (let k = 0; k < index.length; k++) {
        const o = index[k] * 3;
        position[o] += delta[k * 3] * w;
        position[o + 1] += delta[k * 3 + 1] * w;
        position[o + 2] += delta[k * 3 + 2] * w;
      }
    }
    accumulate.fill(0);
    const idx = scan.index;
    for (let f = 0; f < idx.length; f += 3) {
      const a = idx[f] * 3,
        b = idx[f + 1] * 3,
        c = idx[f + 2] * 3;
      const ux = position[b] - position[a],
        uy = position[b + 1] - position[a + 1],
        uz = position[b + 2] - position[a + 2];
      const vx = position[c] - position[a],
        vy = position[c + 1] - position[a + 1],
        vz = position[c + 2] - position[a + 2];
      const nx = uy * vz - uz * vy,
        ny = uz * vx - ux * vz,
        nz = ux * vy - uy * vx;
      for (let k = 0; k < 3; k++) {
        const g = group[idx[f + k]] * 3;
        accumulate[g] += nx;
        accumulate[g + 1] += ny;
        accumulate[g + 2] += nz;
      }
    }
    for (let i = 0; i < count; i++) {
      const g = group[i] * 3;
      const l =
        Math.hypot(accumulate[g], accumulate[g + 1], accumulate[g + 2]) || 1;
      normal[i * 3] = accumulate[g] / l;
      normal[i * 3 + 1] = accumulate[g + 1] / l;
      normal[i * 3 + 2] = accumulate[g + 2] / l;
    }
  }

  /** Which part of the beard area a style covers, per vertex (0..1). */
  function beardRegion(style: RenderState['beard']) {
    const out = new Float32Array(count);
    if (style === 'clean') return out;
    for (let i = 0; i < count; i++) {
      if (!beardAll[i]) continue;
      const px = scan.uv[i * 2] * 1024,
        py = (1 - scan.uv[i * 2 + 1]) * 1024;
      const moustache =
        (1 - smooth(95, 120, Math.abs(px - 512))) * (1 - smooth(470, 480, py));
      const chin =
        (1 - smooth(70, 95, Math.abs(px - 512))) *
        smooth(486, 500, py) *
        (1 - smooth(640, 670, py));
      const region =
        style === 'mustache'
          ? moustache
          : style === 'goatee'
            ? Math.max(moustache, chin)
            : 1;
      out[i] = beardAll[i] * region;
    }
    return out;
  }

  type Thickness = (i: number, x: number, y: number, z: number) => number;
  type Shift = (
    i: number,
    x: number,
    y: number,
    z: number,
    t: number,
    out: Float32Array
  ) => void;

  /**
   * A shell: the triangles where `thickness` is positive, pushed out along the normal.
   * Vertices where it is zero stay on the skin, so the edge closes without a seam.
   */
  function shell(thickness: Thickness, shift?: Shift) {
    const t = new Float32Array(count);
    for (let i = 0; i < count; i++)
      t[i] = Math.max(
        0,
        thickness(i, base[i * 3], base[i * 3 + 1], base[i * 3 + 2])
      );
    const remap = new Int32Array(count).fill(-1);
    const source: number[] = [];
    const index: number[] = [];
    const idx = scan.index;
    for (let f = 0; f < idx.length; f += 3) {
      if (t[idx[f]] + t[idx[f + 1]] + t[idx[f + 2]] <= 0) continue;
      for (let k = 0; k < 3; k++) {
        const v = idx[f + k];
        if (remap[v] < 0) {
          remap[v] = source.length;
          source.push(v);
        }
        index.push(remap[v]);
      }
    }
    const n = source.length;
    const out = {
      position: new Float32Array(n * 3),
      normal: new Float32Array(n * 3),
      base: new Float32Array(n * 3),
      depth: new Float32Array(n),
      index: Uint32Array.from(index),
    };
    const offset = new Float32Array(3);
    /** Recompute from the current (morphed) head. */
    function update() {
      for (let k = 0; k < n; k++) {
        const v = source[k],
          o = v * 3;
        offset.fill(0);
        shift?.(v, base[o], base[o + 1], base[o + 2], t[v], offset);
        out.position[k * 3] = position[o] + normal[o] * t[v] + offset[0];
        out.position[k * 3 + 1] =
          position[o + 1] + normal[o + 1] * t[v] + offset[1];
        out.position[k * 3 + 2] =
          position[o + 2] + normal[o + 2] * t[v] + offset[2];
        out.base[k * 3] = base[o];
        out.base[k * 3 + 1] = base[o + 1];
        out.base[k * 3 + 2] = base[o + 2];
        out.depth[k] = t[v];
      }
      // Smooth normals of the shell itself.
      out.normal.fill(0);
      const p = out.position,
        nn = out.normal,
        ix = out.index;
      for (let f = 0; f < ix.length; f += 3) {
        const a = ix[f] * 3,
          b = ix[f + 1] * 3,
          c = ix[f + 2] * 3;
        const ux = p[b] - p[a],
          uy = p[b + 1] - p[a + 1],
          uz = p[b + 2] - p[a + 2];
        const vx = p[c] - p[a],
          vy = p[c + 1] - p[a + 1],
          vz = p[c + 2] - p[a + 2];
        const nx = uy * vz - uz * vy,
          ny = uz * vx - ux * vz,
          nz = ux * vy - uy * vx;
        for (const q of [a, b, c]) {
          nn[q] += nx;
          nn[q + 1] += ny;
          nn[q + 2] += nz;
        }
      }
      // Fall back to the head normal where the shell is thin, which also hides the unwelded seams.
      for (let k = 0; k < n; k++) {
        const o = source[k] * 3;
        const l = Math.hypot(nn[k * 3], nn[k * 3 + 1], nn[k * 3 + 2]) || 1;
        for (let c = 0; c < 3; c++)
          nn[k * 3 + c] = (nn[k * 3 + c] / l) * 0.5 + normal[o + c] * 0.5;
      }
    }
    return { ...out, update };
  }

  function hairShell(style: RenderState['hair']['style']) {
    const thickness: Thickness = (i, x, y, z) => {
      const edge = scalp[i];
      const top = smooth(1.8, 3.6, y);
      const side = Math.max(-1, Math.min(1, (x - CX) / 1.2));
      switch (style) {
        case 'close':
          return 0.03 * edge;
        case 'buzz':
          return 0.085 * edge;
        case 'crop':
          return (0.1 + 0.2 * top) * edge;
        case 'side':
          return (0.13 + 0.24 * top) * edge * (1 + 0.4 * side);
        case 'swept':
          return (0.16 + 0.34 * top) * edge;
        case 'waves':
          return (
            (0.2 + 0.26 * top) *
            edge *
            (1 + 0.3 * Math.sin(x * 5 + y * 3) * Math.sin(z * 4 + y * 2))
          );
        case 'long': {
          // Long hair also falls behind the ears and down the neck.
          const fall =
            front[i] < 0.3
              ? smooth(-1.7, -0.9, y) *
                (1 - smooth(1.2, 2.2, y)) *
                smooth(0.3, 0, front[i])
              : 0;
          return Math.max((0.16 + 0.2 * top) * edge, 0.3 * fall);
        }
      }
    };
    const shift: Shift | undefined =
      style === 'side'
        ? (_i, _x, y, _z, t, out) => {
            out[0] = 0.5 * t * smooth(2.4, 3.6, y);
          }
        : style === 'swept'
          ? (i, _x, y, _z, t, out) => {
              const f = Math.max(0, front[i]);
              out[1] = 0.35 * t * f;
              out[2] = -0.7 * t * smooth(2.2, 3.4, y) * (1 - f);
            }
          : undefined;
    return shell(thickness, shift);
  }

  function beardShell(style: RenderState['beard']) {
    const region = beardRegion(style);
    const depth = {
      clean: 0,
      stubble: 0,
      mustache: 0.05,
      goatee: 0.07,
      short: 0.07,
      full: 0.17,
    }[style];
    return {
      region,
      shell: depth ? shell((i) => region[i] * depth) : undefined,
    };
  }

  /** Clothes: one or two shells below a neckline. `layer` 0 is the garment, 1 an outer coat. */
  function outfitShell(style: RenderState['outfit']['style'], layer: 0 | 1) {
    const thickness: Thickness = (_i, x, y, z) => {
      const dx = x - CX;
      const c = facing(x, z, -0.2);
      const f = smooth(-0.2, 1, c);
      const centre = (width: number) =>
        Math.max(0, 1 - Math.abs(dx) / width) * smooth(0.3, 0.8, c);
      if (layer === 1) {
        // Jacket and trench: open down the front, with a raised collar on the trench.
        const line = style === 'trench' ? -0.35 - 0.45 * f : -0.85 - 0.5 * f;
        const open =
          smooth(0.3, 0.8, c) *
          (1 - smooth(0.18, 0.5, Math.abs(dx) - 0.25 * smooth(-1.2, -3.6, y)));
        const collar =
          style === 'trench'
            ? 0.16 * (1 - smooth(0, 0.8, line - y))
            : 0.07 * (1 - smooth(0, 0.5, line - y));
        return (0.2 + collar) * smooth(0, 0.14, line - y) * (1 - open);
      }
      let line = -1.05 - 0.45 * f;
      let depth = 0.075;
      let collar = 0;
      if (style === 'vneck') line = -1.0 - 0.4 * f - centre(0.75) * 1.5;
      if (style === 'turtle') {
        line = -0.15 - 0.55 * f;
        depth = 0.13;
      }
      if (style === 'collar') {
        line = -0.9 - 0.4 * f - centre(0.35) * 0.9;
        collar = 0.1 * (1 - smooth(0, 0.42, line - y));
      }
      if (style === 'jacket') line = -1.0 - 0.45 * f - centre(0.5) * 0.7;
      if (style === 'trench') line = -0.6 - 0.5 * f;
      return (depth + collar) * smooth(0, 0.12, line - y);
    };
    return shell(thickness);
  }

  return {
    scan,
    count,
    base,
    position,
    normal,
    scalp,
    deform,
    hairShell,
    beardShell,
    outfitShell,
  };
}
