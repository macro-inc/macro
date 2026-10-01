import { createMemo } from 'solid-js';
import { render } from 'solid-js/web';
import { expect, it, vi } from 'vitest';
import {
  children,
  createGraphicsEditor,
  createScene,
  drawableIds,
  type GraphicsItem,
  hitTest,
  selectionFrame,
  sortKeysBetween,
  translation,
} from '../src/core';
import { defaultRenderers, GraphicsSurface } from '../src/solid';

function scene(count: number) {
  const keys = sortKeysBetween(null, null, count);
  const items: GraphicsItem[] = Array.from({ length: 3 }, (_, i) => ({
    id: `g${i}`,
    type: 'group',
    placement: { parentId: 'scene-root', sortKey: `a${i}` },
    transform: translation(0, 0),
  }));
  keys.forEach((sortKey, i) =>
    items.push({
      id: `r${i}`,
      type: 'rectangle',
      placement: { parentId: `g${i % 3}`, sortKey },
      transform: translation((i % 50) * 30, Math.floor(i / 50) * 30),
      geometry: { width: 20, height: 20 },
      appearance: { fill: '#ccc', stroke: '#333', cornerRadius: 4 },
    })
  );
  return createScene(items);
}
it('keeps 2000 mounted shapes stable and does not propagate pan or selection into their scale', () => {
  const editor = createGraphicsEditor(scene(2000));
  const host = document.createElement('div');
  const scaleReads = vi.fn();
  const mounts = vi.fn();
  const Rectangle = defaultRenderers.rectangle;
  const dispose = render(
    () => (
      <GraphicsSurface
        editor={editor}
        input={{ tool: () => 'select' }}
        renderers={{
          rectangle: (props) => {
            mounts();
            const scale = createMemo(() => {
              scaleReads();
              return props.scale;
            });
            return <Rectangle item={props.item} scale={scale()} />;
          },
        }}
      />
    ),
    host
  );
  try {
    expect(mounts).toHaveBeenCalledTimes(2000);
    const node = host.querySelector('[data-graphics-item="r0"]');
    scaleReads.mockClear();
    const start = performance.now();
    for (let i = 0; i < 20; i++) editor.panBy({ x: 2, y: 3 });
    console.info('2000 shapes pan avg ms', (performance.now() - start) / 20);
    expect(scaleReads).not.toHaveBeenCalled();
    editor.select('g0');
    expect(scaleReads).not.toHaveBeenCalled();
    expect(
      host.querySelectorAll('[data-graphics-selection-outline]')
    ).toHaveLength(667);
    editor.beginTransform('g0', { x: 0, y: 0 });
    const dragStart = performance.now();
    for (let i = 0; i < 10; i++) editor.updateTransform({ x: i * 3, y: i * 2 });
    expect(
      Array.from(
        host.querySelectorAll<HTMLElement>('[data-graphics-item]')
      ).filter((node) => node.style.translate)
    ).toHaveLength(667);
    console.info(
      '2000 shapes group drag avg ms',
      (performance.now() - dragStart) / 10
    );
    editor.cancelTransform();
    expect(mounts).toHaveBeenCalledTimes(2000);
    expect(host.querySelector('[data-graphics-item="r0"]')).toBe(node);
  } finally {
    dispose();
    editor.dispose();
  }
});
it('invalidates hierarchy and hit indexes across document edits and undo', () => {
  const editor = createGraphicsEditor(scene(60));
  expect(hitTest(editor.document, { x: 10, y: 10 })).toBe('g0');
  expect(drawableIds(editor.document)).toHaveLength(60);
  editor.select('g0');
  editor.deleteSelection();
  expect(drawableIds(editor.document)).toHaveLength(40);
  expect(hitTest(editor.document, { x: 10, y: 10 })).toBeUndefined();
  editor.undo();
  expect(children(editor.document, 'g0')).toHaveLength(20);
  expect(selectionFrame(editor.document, ['g0'])).toBeDefined();
  expect(hitTest(editor.document, { x: 10, y: 10 })).toBe('g0');
  editor.dispose();
});
it('does not retain a stale hierarchy for mutable scene builders', () => {
  const original = scene(2);
  const mutable = { ...original, items: { ...original.items } };
  expect(children(mutable, 'g0')).toEqual(['r0']);
  delete mutable.items.r0;
  expect(children(mutable, 'g0')).toEqual([]);
  expect(drawableIds(mutable)).toEqual(['r1']);
});

it('moves 403 of 1000 shapes with shared translation without repainting their content', () => {
  const keys = sortKeysBetween(null, null, 1000);
  const editor = createGraphicsEditor(
    keys.map((sortKey, i) => ({
      id: `box-${i}`,
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey },
      transform: translation(i * 25, 0),
      geometry: { width: 20, height: 20 },
      appearance: { fill: '#ccc', stroke: '#333' },
    }))
  );
  editor.execute(
    {
      id: 'select-boxes',
      apply: ({ document }) => ({
        document,
        selection: keys.slice(0, 403).map((_, i) => `box-${i}`),
      }),
    },
    undefined
  );
  const host = document.createElement('div');
  const paints = vi.fn();
  const Rectangle = defaultRenderers.rectangle;
  let currentTransform = translation(0, 0);
  const dispose = render(
    () => (
      <GraphicsSurface
        editor={editor}
        input={{ tool: () => 'select' }}
        renderers={{
          rectangle: (props) => {
            createMemo(() => {
              paints(props.item.geometry, props.item.appearance);
            });
            if (props.item.id === 'box-0')
              createMemo(() => {
                currentTransform = props.item.transform;
              });
            return <Rectangle {...props} />;
          },
        }}
      />
    ),
    host
  );
  const observer = new MutationObserver(() => {});
  try {
    const nodes = Array.from(
      host.querySelectorAll<HTMLElement>('[data-graphics-item]')
    );
    editor.beginTransform('box-0', { x: 0, y: 0 });
    paints.mockClear();
    observer.observe(host, {
      subtree: true,
      attributes: true,
      childList: true,
    });
    for (let i = 1; i <= 10; i++)
      editor.updateTransform({ x: i * 3, y: i * 2 });
    expect(paints).not.toHaveBeenCalled();
    expect(currentTransform).toEqual(translation(30, 20));
    expect(nodes[0]?.style.translate).toBe('30px 20px');
    expect(nodes.filter((node) => node.style.translate)).toHaveLength(403);
    expect(
      host.querySelectorAll('[data-graphics-selection-outline]')
    ).toHaveLength(403);
    // Pointer updates touch only the moving wrappers and geometry outlines,
    // never their content, untouched shapes, or the enclosing scene.
    const mutations = observer.takeRecords();
    expect(mutations.length).toBeGreaterThan(0);
    const movedElements = new Set([
      ...nodes.slice(0, 403),
      ...host.querySelectorAll('[data-graphics-selection-outline]'),
    ]);
    expect(
      mutations.every(
        (record) =>
          movedElements.has(record.target as Element) &&
          record.attributeName === 'style'
      )
    ).toBe(true);
    expect(Array.from(host.querySelectorAll('[data-graphics-item]'))).toEqual(
      nodes
    );
    editor.cancelTransform();
    expect(nodes.every((node) => !node.style.translate)).toBe(true);
    expect(currentTransform).toEqual(translation(0, 0));
    // A real paint edit still reaches the live view after the gesture.
    editor.setSelectionAppearance({ fill: '#f00' });
    expect(paints).toHaveBeenCalled();
    expect(nodes[0]?.querySelector('rect')?.getAttribute('fill')).toBe('#f00');
    expect(nodes[999]?.querySelector('rect')?.getAttribute('fill')).toBe(
      '#ccc'
    );
  } finally {
    observer.disconnect();
    dispose();
    editor.dispose();
  }
});
