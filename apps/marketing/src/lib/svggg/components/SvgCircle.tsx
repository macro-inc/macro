import type { PathCommand, PathData } from '../types/svgTypes';
import { SvgPath } from './SvgPath';

const K = (4 / 3) * Math.tan(Math.PI / 8);

const CIRCLE_COMMANDS: PathCommand[] = [
  { type: 'M', points: [{ x: 0, y: 0, z: 0 }] },
  {
    type: 'C',
    points: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    ],
  },
  {
    type: 'C',
    points: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    ],
  },
  {
    type: 'C',
    points: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    ],
  },
  {
    type: 'C',
    points: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    ],
  },
  { type: 'Z', points: [] },
];

const UNIT_CIRCLE_POINTS = new Float32Array([
  -1,
  0,
  0,
  -1,
  K,
  0,
  -K,
  1,
  0,
  0,
  1,
  0,
  K,
  1,
  0,
  1,
  K,
  0,
  1,
  0,
  0,
  1,
  -K,
  0,
  K,
  -1,
  0,
  0,
  -1,
  0,
  -K,
  -1,
  0,
  -1,
  -K,
  0,
  -1,
  0,
  0,
]);

const UNIT_CIRCLE_PATH: PathData = {
  packedPoints: UNIT_CIRCLE_POINTS,
  commands: CIRCLE_COMMANDS,
  attributes: {},
};

const UNIT_CIRCLE_PATHS: PathData[] = [UNIT_CIRCLE_PATH];

export function SvgCircle(props: Parameters<typeof SvgPath>[0]) {
  return <SvgPath paths={UNIT_CIRCLE_PATHS} {...props} />;
}
