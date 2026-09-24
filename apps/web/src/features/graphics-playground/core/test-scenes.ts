import {
  createScene,
  type GraphicsDocument,
  type GraphicsItem,
  multiply,
  rotation,
  scaling,
  translation,
} from '@macro-inc/graphics';

// Disposable in-memory demo data. Update these scripts when the model changes.
export function createGraphicsTestScene(): GraphicsDocument {
  return createScene([
    {
      id: 'rectangle-a',
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: translation(96, 96),
      geometry: { width: 240, height: 160 },
      appearance: { fill: 'var(--color-accent)', stroke: 'var(--color-ink)' },
    },
    {
      id: 'rectangle-b',
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey: 'a1' },
      transform: translation(400, 192),
      geometry: { width: 180, height: 240 },
      appearance: { fill: 'transparent', stroke: 'var(--color-ink-muted)' },
    },
    {
      id: 'rectangle-c',
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey: 'a2' },
      transform: translation(176, 336),
      geometry: { width: 160, height: 112 },
      appearance: { fill: 'transparent', stroke: 'var(--color-accent)' },
    },
  ]);
}

export function createNestedTestScene(): GraphicsDocument {
  const nodes: GraphicsItem[] = [
    {
      id: 'outer-group',
      type: 'group',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: multiply(
        translation(130, 120),
        multiply(rotation(0.25), scaling(1.15, 0.8))
      ),
    },
    {
      id: 'outer-rectangle',
      type: 'rectangle',
      placement: { parentId: 'outer-group', sortKey: 'a0' },
      transform: translation(0, 0),
      geometry: { width: 180, height: 90 },
      appearance: { fill: 'var(--color-accent)', stroke: 'var(--color-ink)' },
    },
    {
      id: 'inner-group',
      type: 'group',
      placement: { parentId: 'outer-group', sortKey: 'a1' },
      transform: multiply(translation(60, 140), rotation(-0.6)),
    },
    {
      id: 'inner-rectangle',
      type: 'rectangle',
      placement: { parentId: 'inner-group', sortKey: 'a0' },
      transform: translation(0, 0),
      geometry: { width: 150, height: 85 },
      appearance: { fill: 'var(--color-input)', stroke: 'var(--color-accent)' },
    },
    {
      id: 'inner-small',
      type: 'rectangle',
      placement: { parentId: 'inner-group', sortKey: 'a1' },
      transform: translation(100, 110),
      geometry: { width: 70, height: 60 },
      appearance: { fill: 'var(--color-panel)', stroke: 'var(--color-ink)' },
    },
    {
      id: 'root-rectangle',
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey: 'a1' },
      transform: translation(430, 110),
      geometry: { width: 100, height: 100 },
      appearance: { fill: 'var(--color-input)', stroke: 'var(--color-ink)' },
    },
  ];
  return createScene(nodes);
}

export function createPeerTestScene(): GraphicsDocument {
  return createScene([
    {
      id: 'rectangle',
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: translation(40, 40),
      geometry: { width: 150, height: 100 },
      appearance: { fill: 'var(--color-accent)', stroke: 'var(--color-ink)' },
    },
    {
      id: 'ellipse',
      type: 'ellipse',
      placement: { parentId: 'scene-root', sortKey: 'a1' },
      transform: translation(135, 90),
      geometry: { width: 140, height: 100 },
      appearance: { fill: 'var(--color-input)', stroke: 'var(--color-ink)' },
    },
    {
      id: 'group',
      type: 'group',
      placement: { parentId: 'scene-root', sortKey: 'a2' },
      transform: multiply(translation(85, 245), rotation(0.15)),
    },
    {
      id: 'child-a',
      type: 'rectangle',
      placement: { parentId: 'group', sortKey: 'a0' },
      transform: translation(0, 0),
      geometry: { width: 100, height: 70 },
      appearance: { fill: 'transparent', stroke: 'var(--color-accent)' },
    },
    {
      id: 'child-b',
      type: 'rectangle',
      placement: { parentId: 'group', sortKey: 'a1' },
      transform: translation(65, 45),
      geometry: { width: 100, height: 70 },
      appearance: { fill: 'var(--color-input)', stroke: 'var(--color-ink)' },
    },
  ]);
}
