import { createScene, translation } from '@macro-inc/graphics';
import { initialAppearance } from './defaults';

export { initialAppearance } from './defaults';

/** Shared test fixture for Canvas Next state and interaction tests. */
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
