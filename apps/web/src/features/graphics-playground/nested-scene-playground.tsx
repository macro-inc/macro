import {
  createScene,
  type GraphicsItem,
  multiply,
  rotation,
  scaling,
  translation,
} from '@macro-inc/graphics';
import GraphicsPlayground from './graphics-playground';

export default function NestedScenePlayground() {
  const nodes: GraphicsItem[] = [
    {
      id: 'outer-group',
      type: 'group',
      placement: { parentId: 'scene-root', order: 0 },
      transform: multiply(
        translation(130, 120),
        multiply(rotation(0.25), scaling(1.15, 0.8))
      ),
    },
    {
      id: 'outer-rectangle',
      type: 'rectangle',
      placement: { parentId: 'outer-group', order: 0 },
      transform: translation(0, 0),
      geometry: { width: 180, height: 90 },
      appearance: { fill: 'var(--color-accent)', stroke: 'var(--color-ink)' },
    },
    {
      id: 'inner-group',
      type: 'group',
      placement: { parentId: 'outer-group', order: 1 },
      transform: multiply(translation(60, 140), rotation(-0.6)),
    },
    {
      id: 'inner-rectangle',
      type: 'rectangle',
      placement: { parentId: 'inner-group', order: 0 },
      transform: translation(0, 0),
      geometry: { width: 150, height: 85 },
      appearance: { fill: 'var(--color-input)', stroke: 'var(--color-accent)' },
    },
    {
      id: 'inner-small',
      type: 'rectangle',
      placement: { parentId: 'inner-group', order: 1 },
      transform: translation(100, 110),
      geometry: { width: 70, height: 60 },
      appearance: { fill: 'var(--color-panel)', stroke: 'var(--color-ink)' },
    },
    {
      id: 'root-rectangle',
      type: 'rectangle',
      placement: { parentId: 'scene-root', order: 1 },
      transform: translation(430, 110),
      geometry: { width: 100, height: 100 },
      appearance: { fill: 'var(--color-input)', stroke: 'var(--color-ink)' },
    },
  ];
  return (
    <GraphicsPlayground
      scene={createScene(nodes)}
      label="Nested scene playground"
      inspector
    />
  );
}
