import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import type { Timeline } from '../../../lib/animal/types/animalTypes';
import { animate } from '../../../lib/animal/utils/animalClock';
import { SvgGroup } from '../../../lib/svggg/components/SvgGroup';
import { SvgScene } from '../../../lib/svggg/components/SvgScene';
import type { Mat4 } from '../../../lib/svggg/types/svgTypes';
import { useParentMatrix } from '../../../lib/svggg/utils/svgContext';
import { createVisible } from '../../utils/utilVisible';

// Retro computer wireframe, extracted from site-v21's model-computer.glb and
// baked down to feature edges (coplanar triangulation diagonals removed).
// Vertices are centered on the origin in viewBox units; CENTER shifts them to
// the 24x24 viewBox center so group/scene rotations pivot through the model.
const VERTS: [number, number, number][] = [
  [-7.14, 7.09, 1.82],
  [6.19, 7.09, 1.82],
  [-7.14, 7.09, -7.88],
  [6.19, 7.09, -7.88],
  [-1.88, 4.01, 0.92],
  [0.93, 4.01, 0.92],
  [-1.88, 4.01, -2.06],
  [0.93, 4.01, -2.06],
  [-7.14, 4.01, -7.88],
  [-7.14, 4.01, 1.82],
  [6.19, 4.01, 1.82],
  [6.19, 4.01, -7.88],
  [-1.88, 3.54, 0.92],
  [0.93, 3.54, 0.92],
  [-1.88, 3.54, -2.06],
  [0.93, 3.54, -2.06],
  [3.38, 2.64, -9.04],
  [-4.33, 2.64, -9.04],
  [3.98, 1.41, 1.77],
  [-4.93, 1.41, 1.77],
  [3.38, -5.83, -9.04],
  [-4.33, -5.83, -9.04],
  [3.98, -4.96, 1.77],
  [-4.93, -4.96, 1.77],
  [-7.07, 3.54, 1.77],
  [6.12, 3.54, 1.77],
  [-7.07, -7.09, 1.77],
  [6.12, -7.09, 1.77],
  [-4.93, 1.41, 1.06],
  [3.98, 1.41, 1.06],
  [-4.93, -4.96, 1.06],
  [3.98, -4.96, 1.06],
  [6.12, 3.54, -2.36],
  [-7.07, 3.54, -2.36],
  [6.12, -7.09, -2.36],
  [-7.07, -7.09, -2.36],
  [-6.44, 3.2, -2.36],
  [5.49, 3.2, -2.36],
  [5.49, -6.75, -2.36],
  [-6.44, -6.75, -2.36],
  [-5.67, 3.01, -5.01],
  [4.72, -6.19, -5.01],
  [4.72, 3.01, -5.01],
  [-5.67, -6.19, -5.01],
  [-7.7, 7.09, 9.04],
  [4.28, 7.09, 8.33],
  [-8, 7.09, 3.87],
  [3.97, 7.09, 3.16],
  [-8, 5.55, 3.87],
  [-7.7, 6.24, 9.04],
  [4.28, 6.24, 8.33],
  [3.97, 5.55, 3.16],
  [-7.93, 7.09, 5.07],
  [4.05, 7.09, 4.36],
  [-7.93, 5.55, 5.07],
  [4.05, 5.55, 4.36],
  [8, 7.09, 4.57],
  [5.81, 7.09, 4.29],
  [7.51, 7.09, 8.48],
  [5.32, 7.09, 8.2],
  [8, 6.37, 4.57],
  [5.81, 6.37, 4.29],
  [7.51, 6.37, 8.48],
  [5.32, 6.37, 8.2],
  [7.76, 7.09, 6.52],
  [5.57, 7.09, 6.25],
  [7.76, 5.98, 6.52],
  [5.57, 5.98, 6.25],
  [6.65, 5.98, 6.38],
  [6.65, 5.98, 6.38],
  [6.9, 6.37, 4.43],
  [6.9, 6.37, 4.43],
];

const EDGES: [number, number][] = [
  [0, 2],
  [2, 3],
  [1, 3],
  [0, 1],
  [5, 7],
  [7, 15],
  [13, 15],
  [5, 13],
  [1, 10],
  [9, 10],
  [0, 9],
  [3, 11],
  [10, 11],
  [8, 9],
  [2, 8],
  [8, 11],
  [4, 6],
  [4, 5],
  [6, 7],
  [25, 32],
  [32, 34],
  [27, 34],
  [25, 27],
  [4, 12],
  [12, 14],
  [6, 14],
  [14, 15],
  [12, 13],
  [24, 33],
  [24, 25],
  [32, 33],
  [24, 26],
  [26, 35],
  [33, 35],
  [16, 17],
  [17, 21],
  [20, 21],
  [16, 20],
  [22, 23],
  [23, 30],
  [30, 31],
  [22, 31],
  [34, 35],
  [26, 27],
  [18, 19],
  [18, 22],
  [19, 23],
  [28, 29],
  [29, 31],
  [28, 30],
  [18, 29],
  [19, 28],
  [36, 37],
  [38, 39],
  [37, 38],
  [36, 39],
  [36, 40],
  [39, 43],
  [38, 41],
  [37, 42],
  [41, 43],
  [16, 42],
  [17, 40],
  [21, 43],
  [20, 41],
  [47, 53],
  [46, 47],
  [46, 52],
  [48, 54],
  [48, 51],
  [51, 55],
  [54, 55],
  [45, 53],
  [45, 50],
  [50, 55],
  [46, 48],
  [47, 51],
  [44, 45],
  [44, 49],
  [49, 50],
  [44, 52],
  [49, 54],
  [56, 60],
  [60, 61],
  [57, 61],
  [56, 57],
  [58, 64],
  [58, 62],
  [62, 66],
  [61, 67],
  [61, 70],
  [68, 70],
  [67, 68],
  [57, 65],
  [59, 65],
  [63, 67],
  [59, 63],
  [56, 64],
  [60, 66],
  [66, 69],
  [69, 71],
  [60, 71],
  [58, 59],
  [62, 63],
  [66, 67],
];

const CENTER = 12;

function project(m: Mat4, x: number, y: number, z: number): string {
  const sx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const sy = m[1] * x + m[5] * y + m[9] * z + m[13];
  return `${sx.toFixed(2)},${sy.toFixed(2)}`;
}

function ComputerWire() {
  const getM = useParentMatrix();

  const d = createMemo(() => {
    const m = getM();
    const pts = VERTS.map(([x, y, z]) => project(m, x + CENTER, y + CENTER, z));
    let path = '';
    for (const [a, b] of EDGES) {
      path += `M ${pts[a]} L ${pts[b]} `;
    }
    return path.trimEnd();
  });

  return <path d={d()} />;
}

export function SceneComputer() {
  const [rotation, setRotation] = createSignal(0);

  const timeline: Timeline = {
    0.0: [{ signal: setRotation, value: 0, interpolate: 'linear' }],
    1.0: [{ signal: setRotation, value: 360 }],
  };

  let containerEl: HTMLDivElement | undefined;
  const visible = createVisible(() => containerEl);

  // Spin only while near the viewport.
  createEffect(() => {
    if (!visible()) return;
    const dispose = animate({ timeline, duration: 16, loop: true });
    onCleanup(dispose);
  });

  return (
    <div ref={containerEl}>
      <SvgScene
        style={{
          'stroke-linejoin': 'round',
          'box-sizing': 'border-box',
          'stroke-dasharray': '1.6 0.55',
          'stroke-linecap': 'round',
          'stroke-width': '0.15',
          overflow: 'visible',
          stroke: 'var(--a0)',
          display: 'block',
          width: '100%',
          'max-width': '350px',
          fill: 'none',
        }}
        orbitAxes={['x', 'y']}
        viewBox="0 0 24 24"
        rotation={{ x: -14 }}
        orbitControls
      >
        <SvgGroup rotation={{ y: rotation() }}>
          <ComputerWire />
        </SvgGroup>
      </SvgScene>
    </div>
  );
}
