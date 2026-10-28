import {
  type CanvasFile,
  canvasVersion,
  readCanvasFile,
} from './document-format';
import { type LegacyTextCodec, migrateLegacyCanvas } from './migrate-legacy';

export type CanvasLoadResult =
  | { kind: 'next'; file: CanvasFile }
  | { kind: 'error'; message: string };

export function loadCanvasFile(
  value: unknown,
  text: LegacyTextCodec
): CanvasLoadResult {
  try {
    return {
      kind: 'next',
      file:
        canvasVersion(value) === 2
          ? readCanvasFile(value)
          : migrateLegacyCanvas(value, text),
    };
  } catch (error) {
    return {
      kind: 'error',
      message: error instanceof Error ? error.message : 'Could not open canvas',
    };
  }
}
