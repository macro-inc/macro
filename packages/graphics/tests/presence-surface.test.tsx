import { onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { expect, it, vi } from 'vitest';
import { createScene, translation } from '../src/core';
import { CollaborativeGraphicsSurface } from '../src/loro/solid';
import { RectangleView } from '../src/solid';
import { createGraphicsPeerLab } from './helpers/peer-lab';

it('renders remote selections/cursors/ghosts in the receiver camera without remounting or editing its shapes', () => {
  vi.useFakeTimers();
  const lab = createGraphicsPeerLab(
    createScene([
      {
        id: 'a',
        type: 'rectangle',
        placement: { parentId: 'scene-root', sortKey: 'a0' },
        transform: translation(10, 20),
        geometry: { width: 80, height: 60 },
        appearance: { fill: 'red', stroke: 'black' },
      },
    ])
  );
  const a = lab.peers[0]!,
    b = lab.peers[1]!;
  const host = document.createElement('div');
  const mount = vi.fn(),
    unmount = vi.fn();
  const dispose = render(
    () => (
      <CollaborativeGraphicsSurface
        editor={b.editor}
        presence={b.presence}
        renderers={{
          rectangle: (props) => {
            mount();
            onCleanup(unmount);
            return <RectangleView {...props} />;
          },
        }}
      />
    ),
    host
  );
  try {
    const original = host.querySelector('[data-graphics-item="a"]');
    b.editor.zoomAt({ x: 0, y: 0 }, 2);
    b.editor.panBy({ x: 100, y: 50 });
    a.editor.select('a');
    a.presence.setCursor({ x: 10, y: 20 });
    vi.advanceTimersByTime(50);
    expect(
      (host.querySelector('[data-presence-cursor]') as HTMLElement).style
        .transform
    ).toBe('translate(120px, 90px)');
    expect(
      host.querySelector('[data-presence-selection]')?.getAttribute('points')
    ).toBe('120,90 280,90 280,210 120,210');
    expect(host.querySelector('[data-presence-label]')?.textContent).toContain(
      'Alice'
    );
    a.editor.beginTransform('a', { x: 0, y: 0 });
    a.editor.updateTransform({ x: 50, y: 30 });
    vi.advanceTimersByTime(50);
    expect(
      (host.querySelector('[data-presence-preview="a"]') as HTMLElement).style
        .transform
    ).toBe('matrix(1,0,0,1,60,50)');
    expect(host.querySelector('[data-presence-label]')?.textContent).toBe(
      'Alice'
    );
    const ghost = host.querySelector('[data-presence-preview="a"]');
    a.editor.updateTransform({ x: 100, y: 60 });
    vi.advanceTimersByTime(80);
    expect(host.querySelector('[data-presence-preview="a"]')).toBe(ghost);
    const x = Number((ghost as HTMLElement).style.transform.split(',')[4]);
    expect(x).toBeGreaterThan(60);
    expect(x).toBeLessThan(110);
    expect(host.querySelector('[data-graphics-item="a"]')).toBe(original);
    expect((original as HTMLElement).style.transform).toBe(
      'matrix(1,0,0,1,10,20)'
    );
    expect(
      (host.querySelector('[aria-label="Peer awareness"]') as HTMLElement).style
        .pointerEvents
    ).toBe('none');
    expect(b.editor.hitTest({ x: 20, y: 30 })).toBe('a');
    expect(b.editor.getSession().selectedIds).toEqual([]);
    a.editor.commitTransform();
    lab.syncNow();
    expect(host.querySelector('[data-presence-preview]')).toBeNull();
    expect(host.querySelector('[data-graphics-item="a"]')).toBe(original);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(unmount).not.toHaveBeenCalled();
    lab.setConnected(false);
    expect(host.querySelector('[data-presence-peer]')).toBeNull();
  } finally {
    dispose();
    lab.dispose();
    vi.useRealTimers();
  }
});
