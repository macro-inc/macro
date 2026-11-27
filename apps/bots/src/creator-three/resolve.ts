/**
 * Pure mapping from the production draft ({ preset, look }) to everything the renderer draws.
 * No WebGL here: the result is plain JSON, so it is the serializable, deterministic renderer state.
 * Auth, service and pricing fields are deliberately not inputs.
 */
import { choices, type Look, type PresetId, presets } from '../presets';

const STATE_VERSION = 1;

export type MorphKey =
  | 'faceWidth'
  | 'jawDef'
  | 'cheekHigh'
  | 'cheekFull'
  | 'noseWide'
  | 'noseLen'
  | 'tipUp'
  | 'hump'
  | 'tipRound'
  | 'tipSharp'
  | 'eyeTilt'
  | 'browWide'
  | 'browArch'
  | 'browFlat'
  | 'browRidge'
  | 'browOuterUp'
  | 'browFurrow'
  | 'smile'
  | 'smirk'
  | 'lipsFull'
  | 'neckWide'
  | 'forehead'
  | 'ageSag';

export type Rgb = [number, number, number];

export type RenderState = {
  v: number;
  mirror: boolean;
  morph: Record<MorphKey, number>;
  skin: {
    tone: Rgb;
    flush: number;
    freckles: number;
    age: number;
    stubble: number;
    clean: number;
    scalp: number;
    brow: number;
    browCut: number;
    mark: 0 | 1 | 2 | 3;
  };
  eyes: { iris: Rgb; bright: number; open: number; slope: number };
  hair: { style: Look['hair']; color: Rgb };
  beard: Look['beard'];
  outfit: { style: Look['outfit']; color: Rgb };
  eyewear: Look['eyewear'];
  earpiece: Look['earpiece'];
  camera: { distance: number; height: number };
  light: Look['light'];
};

const TONES = [
  '#f6dccb',
  '#eac3a6',
  '#d4a07c',
  '#b07752',
  '#8a5634',
  '#5e3a24',
  '#3f2618',
];

const round = (value: number) => Math.round(value * 1e4) / 1e4;

/** sRGB hex to linear RGB. */
export function linear(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return round(s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
  };
  return [channel((n >> 16) & 255), channel((n >> 8) & 255), channel(n & 255)];
}

function swatch(
  options: readonly (readonly [string, string, string])[],
  id: string
) {
  return linear(options.find(([option]) => option === id)?.[2] ?? '#2e2017');
}

function skinTone(tone: number, under: Look['under']): Rgb {
  const at = Math.min(0.9999, Math.max(0, tone)) * (TONES.length - 1);
  const a = linear(TONES[Math.floor(at)]);
  const b = linear(TONES[Math.floor(at) + 1]);
  const t = at - Math.floor(at);
  const shift = {
    cool: [0.97, 0.99, 1.09],
    neutral: [1, 1, 1],
    warm: [1.05, 1, 0.88],
    olive: [0.95, 1.04, 0.84],
  }[under];
  // Compress the ramp a little so the lightest tone does not clip and the darkest keeps its modelling.
  return [0, 1, 2].map((i) =>
    round(((a[i] + (b[i] - a[i]) * t) * 0.72 + 0.014) * shift[i])
  ) as Rgb;
}

/** Fixed shape offsets per base, so the five bases differ beyond their controls. One scan, five variants. */
const BASE_SHAPE: Record<string, Partial<Record<MorphKey, number>>> = {
  atlas: {},
  ledger: { forehead: 0.4, neckWide: 0.3 },
  scout: { forehead: -0.3, lipsFull: 0.3 },
  patch: { neckWide: 0.5, cheekFull: 0.3 },
  echo: { lipsFull: 0.4, forehead: 0.2, neckWide: -0.3 },
};

export function resolve(preset: PresetId, look: Look): RenderState {
  const entry = presets[preset];
  const m: Record<MorphKey, number> = {
    faceWidth: look.faceWidth * 1.2,
    jawDef: look.jaw,
    cheekHigh: { soft: -0.7, balanced: 0, high: 1 }[look.cheeks],
    cheekFull: { soft: 0.6, balanced: 0, high: -0.3 }[look.cheeks],
    noseWide: { narrow: -1, balanced: 0, broad: 1 }[look.noseBridge],
    noseLen: look.noseLen,
    tipUp: look.noseTip === 'snub' ? 1 : 0,
    hump: look.noseTip === 'aquiline' ? 1 : 0,
    tipRound: look.noseTip === 'soft' ? 1 : 0,
    tipSharp: look.noseTip === 'defined' ? 0.6 : 0,
    eyeTilt: look.eyeTilt * 1.2,
    browWide: look.browSpacing,
    browArch: look.browArch + (look.brow === 'arched' ? 0.6 : 0),
    browFlat: look.brow === 'straight' ? 1 : 0,
    browRidge: {
      thick: 0.8,
      soft: -0.6,
      straight: 0,
      natural: 0,
      arched: 0,
      sharp: 0.2,
    }[look.brow],
    browOuterUp: look.brow === 'sharp' ? 0.8 : 0,
    browFurrow: look.expression === 'focused' ? 1 : 0,
    smile: { composed: 0, warm: 1.5, focused: -0.2, smirk: 0.2 }[
      look.expression
    ],
    smirk: look.expression === 'smirk' ? 1 : 0,
    lipsFull: 0,
    neckWide: 0,
    forehead: 0,
    ageSag: look.ageTexture,
  };
  if (look.gender === 'masculine') {
    m.jawDef += 0.3;
    m.browRidge += 0.5;
    m.neckWide += 0.6;
    m.lipsFull -= 0.3;
  }
  if (look.gender === 'feminine') {
    m.jawDef -= 0.3;
    m.browRidge -= 0.5;
    m.neckWide -= 0.7;
    m.lipsFull += 0.6;
    m.cheekHigh += 0.25;
  }
  for (const [key, value] of Object.entries(BASE_SHAPE[entry.base] ?? {}))
    m[key as MorphKey] += value;
  for (const key of Object.keys(m) as MorphKey[]) m[key] = round(m[key]);

  return {
    v: STATE_VERSION,
    mirror: entry.mirror,
    morph: m,
    skin: {
      tone: skinTone(look.tone, look.under),
      flush: round(look.flush),
      freckles: { none: 0, light: 0.14, medium: 0.3, dense: 0.52 }[
        look.freckles
      ],
      age: round(look.ageTexture),
      stubble: {
        clean: 0,
        stubble: 0.55,
        goatee: 0.8,
        mustache: 0.8,
        short: 0.85,
        full: 0.95,
      }[look.beard],
      clean: look.beard === 'clean' ? 1 : 0.35,
      scalp: look.hair === 'close' ? 0.72 : 0.9,
      brow: {
        straight: 1,
        natural: 1,
        arched: 1,
        thick: 1.5,
        sharp: 1.15,
        soft: 0.55,
      }[look.brow],
      browCut: look.mark === 'brow-scar' ? 1 : 0,
      mark: ({ none: 0, scar: 1, mole: 2, 'brow-scar': 3 } as const)[look.mark],
    },
    eyes: {
      iris: swatch(choices.iris, look.iris),
      bright: round(look.eyeBright),
      open: { composed: 1, warm: 0.86, focused: 0.8, smirk: 0.94 }[
        look.expression
      ],
      slope: round(look.eyeTilt * 0.17),
    },
    hair: {
      style: look.hair,
      color: swatch(choices.hairColor, look.hairColor),
    },
    beard: look.beard,
    outfit: { style: look.outfit, color: swatch(choices.cloth, look.cloth) },
    eyewear: look.eyewear,
    earpiece: look.earpiece,
    camera: {
      close: { distance: 13.5, height: 1.5 },
      standard: { distance: 16, height: 1.5 },
      bust: { distance: 27, height: 0.35 },
    }[look.framing],
    light: look.light,
  };
}
