import { getStrokePoints } from 'perfect-freehand';
import { createRoot } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createGraphicsEditor,
  type PencilItem,
  sortKeysBetween,
  translation,
} from '../src/core';
import { createGraphicsProjection, GraphicsSurface } from '../src/solid';

vi.mock('perfect-freehand', async (original) => {
  const actual = await original<typeof import('perfect-freehand')>();
  return { ...actual, getStrokePoints: vi.fn(actual.getStrokePoints) };
});

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.clearAllMocks();
});

function setup() {
  // Match the sample counts of the reported 11-stroke scene without storing
  // the user's drawing. Count brush executions instead of asserting wall time.
  const counts = [2596, 804, 89, 1281, 892, 182, 64, 214, 323, 253, 343];
  const keys = sortKeysBetween(null, null, counts.length);
  const items = counts.map(
    (count, i): PencilItem => ({
      id: `ink-${i}`,
      type: 'pencil',
      placement: { parentId: 'scene-root', sortKey: keys[i]! },
      transform: translation(0, i * 200),
      appearance: { fill: 'transparent', stroke: 'black', strokeWidth: 10 },
      geometry: {
        simulatePressure: true,
        points: Array.from({ length: count }, (_, j) => [
          (j / (count - 1)) * 500,
          Math.sin((j / (count - 1)) * 6) * 100,
          0.5,
        ]),
      },
    })
  );
  const editor = createGraphicsEditor(items);
  const host = document.createElement('div');
  document.body.append(host);
  const dispose = render(
    () => <GraphicsSurface editor={editor} input={{ tool: () => 'select' }} />,
    host
  );
  const viewport = host.querySelector<HTMLElement>(
    '[aria-label="Graphics canvas"]'
  )!;
  cleanups.push(() => {
    dispose();
    editor.dispose();
    host.remove();
  });
  const hover = (x: number, y: number) =>
    viewport.dispatchEvent(
      new MouseEvent('pointermove', {
        bubbles: true,
        clientX: x,
        clientY: y,
      })
    );
  const path = (id: string) =>
    host.querySelector(`[data-graphics-item="${id}"] path`)!;
  return { editor, host, hover, path };
}

it('reuses ink for hover, pan, selection, move and rotation without rebuilding other strokes', () => {
  const { editor, host, hover, path } = setup();
  const stroke = path('ink-0');
  const ink = stroke.getAttribute('d');
  expect(getStrokePoints).toHaveBeenCalledTimes(11);
  vi.mocked(getStrokePoints).mockClear();

  hover(0, 0);
  expect(
    host.querySelector('[data-graphics-hover-outline="ink-0"]')
  ).not.toBeNull();
  // Panning with a stationary pointer repicks the hover target.
  for (let i = 0; i < 10; i++) {
    hover(1000 + i, 3000);
    editor.panBy({ x: 3, y: 2 });
  }
  expect(getStrokePoints).not.toHaveBeenCalled();
  editor.select('ink-0');
  for (const handle of [undefined, 'rotate'] as const) {
    editor.beginTransform('ink-0', { x: 0, y: 0 }, handle);
    for (let i = 1; i <= 10; i++)
      editor.updateTransform({ x: i * 5, y: i * 3 });
    editor.cancelTransform();
    expect(getStrokePoints).not.toHaveBeenCalled();
  }
  expect(path('ink-0')).toBe(stroke);
  expect(stroke.getAttribute('d')).toBe(ink);
});

it('rebuilds changed ink for stroke width and resize while keeping the same DOM and restoring history', () => {
  const { editor, path } = setup();
  const stroke = path('ink-0');
  const originalPath = stroke.getAttribute('d');
  editor.select('ink-0');
  editor.setSelectionAppearance({ strokeWidth: 20 });
  const widerPath = stroke.getAttribute('d');
  expect(widerPath).not.toBe(originalPath);
  vi.mocked(getStrokePoints).mockClear();
  editor.beginTransform('ink-0', { x: 500, y: 100 }, 'se');
  editor.updateTransform({ x: 700, y: 200 });
  const resizeRebuilds = vi.mocked(getStrokePoints).mock.calls.length;
  expect(resizeRebuilds).toBeGreaterThan(1);
  expect(resizeRebuilds).toBeLessThanOrEqual(4);
  expect(stroke.getAttribute('d')).not.toBe(widerPath);
  expect(getStrokePoints).toHaveBeenCalledTimes(resizeRebuilds);
  editor.commitTransform();
  editor.undo();
  expect(stroke.getAttribute('d')).toBe(widerPath);
  editor.undo();
  expect(stroke.getAttribute('d')).toBe(originalPath);
  expect(path('ink-0')).toBe(stroke);
});

it('publishes matching store and immutable snapshots and unsubscribes both', () => {
  const editor = createGraphicsEditor();
  const projection = createRoot((dispose) => ({
    ...createGraphicsProjection(editor),
    dispose,
  }));
  editor.beginRectangle({ x: 0, y: 0 });
  editor.updateRectangle({ x: 100, y: 100 });
  editor.commitRectangle('rect', { fill: 'transparent', stroke: 'black' });
  const snapshot = projection.snapshot();
  expect(snapshot).toBe(editor.document);
  expect(projection.document.items.rect).toEqual(snapshot.items.rect);
  expect(Object.isFrozen(snapshot.items.rect)).toBe(true);
  projection.dispose();
  editor.undo();
  expect(projection.snapshot()).toBe(snapshot);
  expect(projection.document.items.rect).toEqual(snapshot.items.rect);
  editor.dispose();
});
