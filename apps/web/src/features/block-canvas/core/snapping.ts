import { dotGridLevels } from '@macro-inc/graphics';

export type CanvasSnapMode = 'none' | 'pixel' | 'auto';

export function canvasSnapUnit(
  mode: CanvasSnapMode,
  scale: number,
  gridVisible: boolean
): number | undefined {
  if (mode === 'none') return undefined;
  if (mode === 'pixel') return 1;
  if (!gridVisible) return undefined;
  return dotGridLevels(scale).find((level) => level.opacity > 0)?.unit;
}
