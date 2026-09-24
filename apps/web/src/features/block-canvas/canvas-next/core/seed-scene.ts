import { type Appearance, createScene, translation } from '@macro-inc/graphics';

export const initialAppearance: Appearance = {
  fill: 'transparent',
  stroke: 'var(--color-ink)',
  strokeWidth: 2,
  opacity: 1,
  cornerRadius: 0,
};

/** Disposable demo data; refreshing starts a new document. */
export function createCanvasNextScene() {
  return createScene([
    {
      id: 'welcome-rectangle',
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: translation(100, 100),
      geometry: { width: 240, height: 160 },
      appearance: {
        ...initialAppearance,
        fill: 'var(--color-accent-bg)',
        stroke: 'var(--color-accent)',
        cornerRadius: 16,
      },
    },
    {
      id: 'welcome-ellipse',
      type: 'ellipse',
      placement: { parentId: 'scene-root', sortKey: 'a1' },
      transform: translation(430, 160),
      geometry: { width: 180, height: 180 },
      appearance: {
        ...initialAppearance,
        stroke: 'var(--color-accent)',
        strokeWidth: 4,
      },
    },
    {
      id: 'welcome-small',
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey: 'a2' },
      transform: translation(180, 350),
      geometry: { width: 160, height: 110 },
      appearance: initialAppearance,
    },
  ]);
}
