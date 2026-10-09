import {
  type CanvasFile,
  canvasVersion,
  readCanvasFile,
} from './document-format';
import { type LegacyTextCodec, migrateLegacyCanvas } from './migrate-legacy';

export type CanvasLoadResult =
  | { kind: 'legacy' }
  | { kind: 'next'; file: CanvasFile }
  | { kind: 'error'; message: string; canOpenLegacy: boolean };

export function loadCanvasFile(
  value: unknown,
  enabled: boolean,
  text: LegacyTextCodec
): CanvasLoadResult {
  let version: 1 | 2 | undefined;
  try {
    version = canvasVersion(value);
    if (!enabled)
      return version === 1
        ? { kind: 'legacy' }
        : {
            kind: 'error',
            message:
              'This canvas requires Canvas Next. Enable Canvas Next to open it.',
            canOpenLegacy: false,
          };
    return {
      kind: 'next',
      file:
        version === 2
          ? readCanvasFile(value)
          : migrateLegacyCanvas(value, text),
    };
  } catch (error) {
    return {
      kind: 'error',
      message: error instanceof Error ? error.message : 'Could not open canvas',
      canOpenLegacy: version === 1,
    };
  }
}
