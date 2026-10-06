import { onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { expect, it, vi } from 'vitest';
import { createScene, translation } from '../src/core';
import { GraphicsSurface, RectangleView } from '../src/solid';
import { createGraphicsPeerLab } from './helpers/peer-lab';

it('remote edits and reordering preserve Solid mounts, DOM identity and local selection', () => {
  const lab = createGraphicsPeerLab(
    createScene(
      ['one', 'two'].map((id, index) => ({
        id,
        type: 'rectangle' as const,
        placement: { parentId: 'scene-root', sortKey: `a${index}` },
        transform: translation(index * 100, 20),
        geometry: { width: 80, height: 80 },
        appearance: { fill: 'red', stroke: 'black' },
      }))
    )
  );
  lab.setConnected(false);
  const a = lab.peers[0]!.editor,
    b = lab.peers[1]!.editor;
  const host = document.createElement('div'),
    mounted = vi.fn(),
    unmounted = vi.fn();
  const dispose = render(
    () => (
      <GraphicsSurface
        editor={b}
        renderers={{
          rectangle: (props) => {
            mounted();
            onCleanup(unmounted);
            return <RectangleView {...props} />;
          },
        }}
      />
    ),
    host
  );
  try {
    const nodes = [...host.querySelectorAll('[data-graphics-item]')];
    b.select('two');
    a.select('one');
    a.reorderSelection('front');
    lab.syncNow();
    expect([...host.querySelectorAll('[data-graphics-item]')]).toEqual([
      nodes[1],
      nodes[0],
    ]);
    expect(b.getSession().selectedId).toBe('two');
    expect(b.getSession().canUndo).toBe(false);
    a.beginTransform('one', { x: 0, y: 0 });
    a.updateTransform({ x: 20, y: 0 });
    a.commitTransform();
    lab.syncNow();
    expect((nodes[0] as HTMLElement).style.transform).toBe(
      'matrix(1,0,0,1,20,20)'
    );
    expect(mounted).toHaveBeenCalledTimes(2);
    expect(unmounted).not.toHaveBeenCalled();
  } finally {
    dispose();
    lab.dispose();
  }
  expect(unmounted).toHaveBeenCalledTimes(2);
});
