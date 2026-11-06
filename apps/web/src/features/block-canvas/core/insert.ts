export type CanvasInsertMode = 'media' | 'reference';

export function canInsertAsset(mode: CanvasInsertMode, blockType: string) {
  return mode === 'reference' || blockType === 'image' || blockType === 'video';
}

/** Clockwise equal slices, with the first option centered above the origin. */
export function radialSliceAtPoint(x: number, y: number, count: number) {
  if (count < 1 || Math.hypot(x, y) < 24) return undefined;
  const turn = Math.PI * 2;
  const slice = turn / count;
  const angle = (Math.atan2(y, x) + Math.PI / 2 + slice / 2 + turn) % turn;
  return Math.floor(angle / slice);
}
