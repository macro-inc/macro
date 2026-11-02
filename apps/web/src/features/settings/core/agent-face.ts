/**
 * An agent's Mark face: two eyes and a mouth made of the three bars in the
 * Macro logo, drawn as lit blocks. While the agent thinks, the bars fold back
 * into the logo itself. Everything here is pure: layout, motion poses, and an
 * orthographic projection to flat polygons that a canvas can fill.
 */

export type AgentFaceStyle = 'classic' | 'curious' | 'cubes' | 'wide' | 'tall';
export type AgentFaceColor = 'clay' | 'iris' | 'mint' | 'sky' | 'rose' | 'ink';

export type AgentFaceLook = { style: AgentFaceStyle; color: AgentFaceColor };

export const AGENT_FACE_STYLES: readonly {
  id: AgentFaceStyle;
  label: string;
}[] = [
  { id: 'classic', label: 'Classic' },
  { id: 'curious', label: 'Curious' },
  { id: 'cubes', label: 'Cubes' },
  { id: 'wide', label: 'Wide' },
  { id: 'tall', label: 'Tall' },
];

type Rgb = readonly [number, number, number];
type Material = { lit: Rgb; shade: Rgb };

/** `swatch` paints the picker and the glow; blocks shade from `lit` to `shade`. */
export const AGENT_FACE_COLORS: readonly {
  id: AgentFaceColor;
  label: string;
  swatch: { light: string; dark: string };
  material: { light: Material; dark: Material };
}[] = [
  {
    id: 'clay',
    label: 'Clay',
    swatch: { light: '#e07d45', dark: '#e88a55' },
    material: {
      light: { lit: [255, 204, 156], shade: [190, 92, 40] },
      dark: { lit: [255, 210, 166], shade: [196, 98, 46] },
    },
  },
  {
    id: 'iris',
    label: 'Iris',
    swatch: { light: '#7a62e6', dark: '#9884f2' },
    material: {
      light: { lit: [212, 199, 255], shade: [80, 56, 186] },
      dark: { lit: [222, 212, 255], shade: [98, 76, 204] },
    },
  },
  {
    id: 'mint',
    label: 'Mint',
    swatch: { light: '#23a776', dark: '#3cba8a' },
    material: {
      light: { lit: [164, 242, 206], shade: [16, 118, 80] },
      dark: { lit: [178, 246, 214], shade: [30, 134, 94] },
    },
  },
  {
    id: 'sky',
    label: 'Sky',
    swatch: { light: '#3d8be6', dark: '#5ea2f0' },
    material: {
      light: { lit: [182, 218, 255], shade: [34, 98, 190] },
      dark: { lit: [196, 226, 255], shade: [50, 116, 206] },
    },
  },
  {
    id: 'rose',
    label: 'Rose',
    swatch: { light: '#de5a8c', dark: '#ea7aa4' },
    material: {
      light: { lit: [255, 194, 216], shade: [184, 50, 100] },
      dark: { lit: [255, 206, 224], shade: [200, 70, 118] },
    },
  },
  {
    id: 'ink',
    label: 'Ink',
    swatch: { light: '#2b2a27', dark: '#e9e6e0' },
    material: {
      light: { lit: [112, 108, 101], shade: [22, 21, 20] },
      dark: { lit: [252, 250, 246], shade: [140, 136, 130] },
    },
  },
];

export function agentFaceColor(id: AgentFaceColor) {
  return (
    AGENT_FACE_COLORS.find((color) => color.id === id) ?? AGENT_FACE_COLORS[0]
  );
}

/**
 * The face an agent without a chosen look wears, derived from its @tag so it
 * stays the same everywhere.
 */
export function agentFaceLook(seed: string): AgentFaceLook {
  // FNV-1a: small, stable, and spreads neighbouring tags apart.
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const styles = AGENT_FACE_STYLES.length;
  return {
    style: AGENT_FACE_STYLES[hash % styles].id,
    color:
      AGENT_FACE_COLORS[Math.floor(hash / styles) % AGENT_FACE_COLORS.length]
        .id,
  };
}

// ---------- layout ----------

type Vec3 = readonly [number, number, number];
type Matrix = readonly number[];
type Part = { position: Vec3; size: Vec3 };
type Parts = { left: Part; right: Part; mouth: Part };

const part = (position: Vec3, size: Vec3): Part => ({ position, size });
const mirror = (eye: Part): Part =>
  part([-eye.position[0], eye.position[1], eye.position[2]], eye.size);

const FACES: Record<AgentFaceStyle, Parts> = {
  classic: {
    left: part([-0.27, 0.84, 0], [0.18, 0.42, 0.18]),
    right: part([0.27, 0.84, 0], [0.18, 0.42, 0.18]),
    mouth: part([0, 0.34, 0], [0.78, 0.14, 0.18]),
  },
  curious: {
    left: part([-0.25, 0.8, 0], [0.17, 0.34, 0.17]),
    right: part([0.25, 0.87, 0], [0.17, 0.48, 0.17]),
    mouth: part([0, 0.34, 0], [0.56, 0.13, 0.17]),
  },
  cubes: {
    left: part([-0.25, 0.8, 0], [0.25, 0.27, 0.25]),
    right: part([0.25, 0.8, 0], [0.25, 0.27, 0.25]),
    mouth: part([0, 0.36, 0], [0.46, 0.15, 0.22]),
  },
  wide: (() => {
    const left = part([-0.36, 0.78, 0], [0.2, 0.26, 0.2]);
    return {
      left,
      right: mirror(left),
      mouth: part([0, 0.36, 0], [0.9, 0.12, 0.18]),
    };
  })(),
  tall: (() => {
    const left = part([-0.15, 0.88, 0], [0.14, 0.56, 0.14]);
    return {
      left,
      right: mirror(left),
      mouth: part([0, 0.32, 0], [0.4, 0.14, 0.16]),
    };
  })(),
};

/** The Macro mark: three parallel slabs stepped back, as in the logo. */
const MARK: Parts = {
  left: part([-0.05, 0.27, 0.48], [0.34, 0.54, 0.17]),
  mouth: part([0, 0.27, 0], [0.95, 0.54, 0.17]),
  right: part([0.28, 0.27, -0.48], [0.95, 0.54, 0.17]),
};

// ---------- motion ----------

/** Everything that moves the face, each 0–1 unless noted. */
export type AgentFacePose = {
  /** Seconds, for the loader-style working motion. */
  time: number;
  /** Where the face looks, -1 to 1 on each axis (y down). */
  lookX: number;
  lookY: number;
  /** 1 is eyes open; blinks dip toward 0. */
  open: number;
  happy: number;
  /** Folds the face into the Macro mark. */
  think: number;
  work: number;
  /** World units off the ground. */
  lift: number;
};

export const RESTING_POSE: AgentFacePose = {
  time: 0,
  lookX: 0,
  lookY: 0,
  open: 1,
  happy: 0,
  think: 0,
  work: 0,
  lift: 0,
};

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const lerp3 = (a: Vec3, b: Vec3, p: number): Vec3 => [
  lerp(a[0], b[0], p),
  lerp(a[1], b[1], p),
  lerp(a[2], b[2], p),
];
const ease = (x: number) => x * x * x * (10 + x * (-15 + 6 * x));

/** R = Ry(yaw) · Rx(pitch): yaw turns the face toward +x, pitch nods it down. */
function rotation(yaw: number, pitch: number): Matrix {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return [cy, sy * sp, sy * cp, 0, cp, -sp, -sy, cy * sp, cy * cp];
}
const apply = (m: Matrix, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

type Block = { center: Vec3; size: Vec3; turn: Matrix };

function blocks(style: AgentFaceStyle, pose: AgentFacePose): Block[] {
  const face = FACES[style];
  const fold = ease(Math.min(1, Math.max(0, pose.think)));
  const flat = 1 - fold;
  const turn = rotation(
    pose.lookX * 0.55 * flat - 0.67 * fold,
    pose.lookY * 0.22 * flat
  );
  const lift = pose.lift + 0.1;
  return (['left', 'mouth', 'right'] as const).map((key, index) => {
    let position = lerp3(face[key].position, MARK[key].position, fold);
    let size = lerp3(face[key].size, MARK[key].size, fold);
    const happy = pose.happy * flat;
    if (key === 'mouth') {
      size = [size[0] * (1 + 0.14 * happy), size[1], size[2]];
      position = [position[0], position[1] + 0.05 * happy, position[2]];
    } else {
      const open = lerp(pose.open, 1, fold) * (1 - 0.3 * pose.work * flat);
      size = [
        size[0] * (1 + 0.35 * happy),
        lerp(size[1] * open, 0.08, happy),
        size[2],
      ];
      position = [
        position[0] + pose.lookX * 0.05 * flat,
        position[1] + 0.06 * happy - pose.lookY * 0.03 * flat,
        position[2],
      ];
    }
    // Working: the bars rise and fall in turn, like the brand loader.
    position = [
      position[0],
      position[1] + pose.work * 0.16 * Math.sin(pose.time * 3.4 - index * 0.9),
      position[2],
    ];
    const placed = apply(turn, position);
    return {
      center: [placed[0], placed[1] + lift, placed[2]],
      size,
      turn,
    };
  });
}

// ---------- projection ----------

/** Seen from slightly above and to the right, like the logo's blocks. */
const CAMERA: Matrix = (() => {
  const tilt = 0.4;
  const yaw = -0.5;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  return [cy, 0, sy, st * sy, ct, -st * cy, -ct * sy, st, ct * cy];
})();
const LIGHT: Vec3 = (() => {
  const v: Vec3 = [-0.35, 0.9, 0.5];
  const length = Math.hypot(...v);
  return [v[0] / length, v[1] / length, v[2] / length];
})();
const CORNERS: Vec3[] = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [
  i & 1 ? 1 : -1,
  i & 2 ? 1 : -1,
  i & 4 ? 1 : -1,
]);
const SIDES: { normal: Vec3; corners: number[] }[] = [
  { normal: [0, 0, 1], corners: [4, 5, 7, 6] },
  { normal: [0, 0, -1], corners: [1, 0, 2, 3] },
  { normal: [1, 0, 0], corners: [5, 1, 3, 7] },
  { normal: [-1, 0, 0], corners: [0, 4, 6, 2] },
  { normal: [0, 1, 0], corners: [6, 7, 3, 2] },
  { normal: [0, -1, 0], corners: [0, 1, 5, 4] },
];

/** A visible block side in a 120-unit square frame, back to front. */
export type FacePolygon = {
  points: [number, number][];
  /** 0 is fully shaded, 1 fully lit. */
  light: number;
  top: boolean;
};

export type FaceShadow = { x: number; y: number; radius: number; lift: number };

/** Projects the face to polygons to fill in order, plus its contact shadow. */
export function projectAgentFace(
  style: AgentFaceStyle,
  pose: AgentFacePose
): { polygons: FacePolygon[]; shadow: FaceShadow } {
  const scale = 76;
  const project = (v: Vec3): [number, number, number] => {
    const view = apply(CAMERA, v);
    return [60 + view[0] * scale, 104 - view[1] * scale, view[2]];
  };
  const ordered = blocks(style, pose)
    .map((block) => ({ block, depth: apply(CAMERA, block.center)[2] }))
    .sort((a, b) => a.depth - b.depth);
  const polygons: FacePolygon[] = [];
  for (const { block } of ordered) {
    const corners = CORNERS.map((corner) => {
      const offset = apply(block.turn, [
        (corner[0] * block.size[0]) / 2,
        (corner[1] * block.size[1]) / 2,
        (corner[2] * block.size[2]) / 2,
      ]);
      return project([
        block.center[0] + offset[0],
        block.center[1] + offset[1],
        block.center[2] + offset[2],
      ]);
    });
    for (const side of SIDES) {
      const normal = apply(block.turn, side.normal);
      // Boxes are convex, so culling back faces leaves no overlaps within one.
      if (apply(CAMERA, normal)[2] <= 0.01) continue;
      const facing =
        normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2];
      polygons.push({
        points: side.corners.map((i) => [corners[i][0], corners[i][1]]),
        light: 0.1 + 0.9 * Math.max(0, facing),
        top: side.normal[1] === 1,
      });
    }
  }
  const [x, y] = project([0, 0, 0]);
  return {
    polygons,
    shadow: { x, y, radius: 0.62 * scale, lift: Math.min(1, pose.lift / 0.3) },
  };
}
