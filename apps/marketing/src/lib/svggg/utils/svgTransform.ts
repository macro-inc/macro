import type { Mat4, PathData } from '../types/svgTypes';
import { transformPointsBatch } from './svgMatrix';

export function buildPathWithMatrix(path: PathData, matrix: Mat4): string {
  const { commands, packedPoints } = path;
  const len = commands.length;
  if (len === 0) {
    return '';
  }

  const results = transformPointsBatch(packedPoints, matrix);

  const parts: string[] = new Array(len);
  let resultIdx = 0;

  for (let i = 0; i < len; i++) {
    const cmd = commands[i];

    switch (cmd.type) {
      case 'M': {
        const x = results[resultIdx * 3];
        const y = results[resultIdx * 3 + 1];
        parts[i] = `M${x.toFixed(2)} ${y.toFixed(2)}`;
        resultIdx++;
        break;
      }
      case 'L': {
        const x = results[resultIdx * 3];
        const y = results[resultIdx * 3 + 1];
        parts[i] = `L${x.toFixed(2)} ${y.toFixed(2)}`;
        resultIdx++;
        break;
      }
      case 'C': {
        const cp1x = results[resultIdx * 3];
        const cp1y = results[resultIdx * 3 + 1];
        const cp2x = results[(resultIdx + 1) * 3];
        const cp2y = results[(resultIdx + 1) * 3 + 1];
        const endx = results[(resultIdx + 2) * 3];
        const endy = results[(resultIdx + 2) * 3 + 1];

        parts[i] =
          `C${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ` +
          `${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ` +
          `${endx.toFixed(2)} ${endy.toFixed(2)}`;
        resultIdx += 3;
        break;
      }
      case 'Z':
        parts[i] = 'Z';
        break;
      default:
        parts[i] = '';
    }
  }

  return parts.join(' ');
}
