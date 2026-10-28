import { createNoise3D } from 'simplex-noise';
import {
  createEffect,
  createMemo,
  createSignal,
  Index,
  onCleanup,
} from 'solid-js';
import { SvgGroup } from '../../../lib/svggg/components/SvgGroup';
import { SvgScene } from '../../../lib/svggg/components/SvgScene';
import type { Mat4 } from '../../../lib/svggg/types/svgTypes';
import { useParentMatrix } from '../../../lib/svggg/utils/svgContext';
import { createVisible } from '../../utils/utilVisible';

const noise3D = createNoise3D();

const LINES = 20;
const Z_SPACING = 3;
const POINTS = 120;
const X_START = 4;
const X_END = 68.4;
const Y_CENTER = 22.2;
const AMPLITUDE = 10;
const NOISE_X_SCALE = 0.35;
const NOISE_Z_SCALE = 0.2;
const TIME_SPEED = 0.008;

// Sine wave constants for the "signal" end of the blend
const SINE_X_FREQ = 0.2; // spatial frequency along x
const SINE_SPEED = 3; // temporal frequency multiplier
const SINE_PHASE = 0.2; // phase offset per line index

function pt(m: Mat4, x: number, y: number, z: number): string {
  const sx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const sy = m[1] * x + m[5] * y + m[9] * z + m[13];
  return `${sx.toFixed(2)},${sy.toFixed(2)}`;
}

// t-units per 10s cycle; stagger transitions across 20% of the cycle
const BLEND_CYCLE = 7 * 60 * TIME_SPEED;
const BLEND_STAGGER = (BLEND_CYCLE * 0.2) / (LINES - 1);

function computeBlend(p: number): number {
  if (p < 0.15) return p / 0.15; // 0→1 over 1.5s
  if (p < 0.75) return 1; // hold at 1 for 6s
  if (p < 0.9) return 1 - (p - 0.75) / 0.15; // 1→0 over 1.5s
  return 0; // hold at 0 for 1s
}

function lineBlend(time: number, lineIndex: number): number {
  const offset = lineIndex * BLEND_STAGGER;
  const phase = (((time - offset) % BLEND_CYCLE) + BLEND_CYCLE) % BLEND_CYCLE;
  return computeBlend(phase / BLEND_CYCLE);
}

// grayMix spans 4..50; precomputed so the per-frame stroke memo does an array
// index instead of building a color-mix template string for 20 lines.
const STROKES: string[] = [];
for (let g = 0; g <= 50; g++) {
  STROKES[g] = `color-mix(in oklch, var(--c3) ${g}%, var(--a0))`;
}

function SignalLine(props: { time: () => number; lineIndex: number }) {
  const getM = useParentMatrix();
  const blend = createMemo(() => lineBlend(props.time(), props.lineIndex));
  const stroke = createMemo(() => {
    const depth = props.lineIndex / (LINES - 1);
    const grayMix = Math.round(4 + blend() * 38 + depth * 8);
    return STROKES[grayMix];
  });
  const d = createMemo(() => {
    const m = getM();
    const t = props.time();
    const b = blend();
    let path = '';
    for (let i = 0; i < POINTS; i++) {
      const x = X_START + (i / (POINTS - 1)) * (X_END - X_START);
      const sineAmp = AMPLITUDE * (1 - 0.5 * (props.lineIndex / (LINES - 1)));
      const noiseZ =
        b < 1
          ? noise3D(i * NOISE_X_SCALE, props.lineIndex * NOISE_Z_SCALE, t) *
            AMPLITUDE
          : 0;
      const sineZ =
        b > 0
          ? Math.sin(
              x * SINE_X_FREQ + t * SINE_SPEED + props.lineIndex * SINE_PHASE
            ) * sineAmp
          : 0;
      const z = noiseZ * (1 - b) + sineZ * b;
      path += (i === 0 ? 'M ' : 'L ') + pt(m, x, Y_CENTER, z) + ' ';
    }
    return path.trimEnd();
  });
  const opacity = 0.2 + 0.8 * (props.lineIndex / (LINES - 1));
  return <path d={d()} style={{ opacity, stroke: stroke() }} />;
}

export function SceneSignal() {
  const [time, setTime] = createSignal(0);
  let containerEl: HTMLDivElement | undefined;
  const visible = createVisible(() => containerEl);

  // The loop only runs while the scene is near the viewport; offscreen it
  // costs nothing (2,400 noise samples + 20 path rewrites per frame).
  createEffect(() => {
    if (!visible()) return;
    let animId = requestAnimationFrame(function tick() {
      setTime((t) => t + TIME_SPEED);
      animId = requestAnimationFrame(tick);
    });
    onCleanup(() => cancelAnimationFrame(animId));
  });

  return (
    <div ref={containerEl}>
      <SvgScene
        viewBox="0 0 72.4 44.4"
        rotation={{ x: 70, z: -20 }}
        scale={{ x: 0.8, y: 0.8, z: 0.8 }}
        orbitConstraints={{
          x: { min: -70, max: 0 },
          z: { min: -70, max: 20 },
        }}
        orbitAxes={['x', 'z']}
        orbitControls
        style={{
          'aspect-ratio': '72.4 / 44.4',
          'stroke-linejoin': 'round',
          'box-sizing': 'border-box',
          'stroke-linecap': 'round',
          'stroke-width': '0.2',
          overflow: 'visible',
          stroke: 'var(--a0)',
          display: 'block',
          width: '100%',
          fill: 'none',
        }}
      >
        <SvgGroup translation={{ y: -((LINES - 1) * Z_SPACING) / 2 }}>
          <Index each={Array(LINES)}>
            {(_, lineIndex) => (
              <SvgGroup translation={{ y: lineIndex * Z_SPACING }}>
                <SignalLine time={time} lineIndex={lineIndex} />
              </SvgGroup>
            )}
          </Index>
        </SvgGroup>
      </SvgScene>
    </div>
  );
}
