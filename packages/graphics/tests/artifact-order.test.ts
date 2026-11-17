import { describe, expect, it } from 'vitest';
import { createScene, translation } from '../src/core';
import {
  movedInPresentation,
  nextPresentOrder,
  presentationOrder,
} from '../src/core/artifact-order';

const artifact = (id: string, presentOrder: string) => ({
  id,
  type: 'artifact' as const,
  placement: { parentId: 'scene-root', sortKey: `a${id}` },
  transform: translation(0, 0),
  appearance: { fill: '#fff', stroke: '#000' },
  geometry: {
    width: 100,
    height: 100,
    title: id,
    html: '',
    designWidth: 100,
    designHeight: 100,
    presentOrder,
  },
});

describe('presentation order', () => {
  it('sorts artifacts by key and breaks ties by id', () => {
    const scene = createScene([
      artifact('3', 'a1'),
      artifact('2', 'a0'),
      artifact('1', 'a1'),
    ]);

    expect(presentationOrder(scene).map((item) => item.id)).toEqual([
      '2',
      '1',
      '3',
    ]);
  });

  it('places a new artifact after every existing one', () => {
    const scene = createScene([artifact('1', 'a5'), artifact('2', 'a2')]);

    expect(nextPresentOrder(scene) > 'a5').toBe(true);
  });

  it('moves an artifact within the presentation and stops at the ends', () => {
    const scene = createScene([artifact('1', 'a0'), artifact('2', 'a1')]);

    expect(movedInPresentation(scene, '1', 1)).toEqual(['2', '1']);
    expect(movedInPresentation(scene, '1', -1)).toBeUndefined();
    expect(movedInPresentation(scene, '2', 1)).toBeUndefined();
  });
});
