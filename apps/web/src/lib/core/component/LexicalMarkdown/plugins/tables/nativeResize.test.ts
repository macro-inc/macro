/** @vitest-environment jsdom */
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { moveNativeTableCells } from './native';
import { createNativeTableResizer } from './nativeResize';

beforeAll(initializeNativeSurfaceTests);

/** jsdom has no PointerEvent; the init fields the resizer reads are enough. */
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'mouse';
    this.isPrimary = init.isPrimary ?? true;
  }
}
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Animation frames run only when a test flushes them. */
function frames() {
  const queue = new Map<number, FrameRequestCallback>();
  let next = 1;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    queue.set(next, callback);
    return next++;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => queue.delete(id));
  return () => {
    const pending = [...queue.values()];
    queue.clear();
    for (const callback of pending) callback(0);
  };
}
function captureOn(element: HTMLElement) {
  const captured = new Set<number>();
  element.setPointerCapture = (id) => captured.add(id);
  element.releasePointerCapture = (id) => captured.delete(id);
  element.hasPointerCapture = (id) => captured.has(id);
  return captured;
}

type Cell = string;
function mount(rows: Cell[][], colWidths?: number[]) {
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  // jsdom computes no CSS zoom (''), which the resizer's zoom walk reads as 0.
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = computed(element, pseudo);
    return new Proxy(style, {
      get(target, property) {
        if (property === 'getPropertyValue')
          return (name: string) =>
            name === 'zoom' ? '1' : target.getPropertyValue(name);
        const value: unknown = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  });
  const fixture = nativeSurface();
  cleanups.push(() => fixture.close());
  fixture.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          {
            type: 'table',
            version: 1,
            ...(colWidths ? { colWidths } : {}),
            children: rows.map((cells) => ({
              type: 'tablerow',
              version: 1,
              children: cells.map((text) => ({
                type: 'tablecell',
                version: 1,
                children: [
                  {
                    type: 'paragraph',
                    version: 1,
                    children: text ? [{ type: 'text', version: 1, text }] : [],
                  },
                ],
              })),
            })),
          },
        ],
      },
    })
  );
  fixture.root.contentEditable = 'true';
  return fixture;
}
function serializedTable(fixture: ReturnType<typeof mount>) {
  const state: unknown = JSON.parse(fixture.view.query.serializedState());
  if (
    !state ||
    typeof state !== 'object' ||
    !('root' in state) ||
    !state.root ||
    typeof state.root !== 'object' ||
    !('children' in state.root) ||
    !Array.isArray(state.root.children)
  )
    throw new Error('Unexpected serialized state');
  const table: unknown = state.root.children[0];
  if (!table || typeof table !== 'object')
    throw new Error('Missing serialized table');
  return table;
}
const widths = (fixture: ReturnType<typeof mount>) => {
  const table = serializedTable(fixture);
  return 'colWidths' in table ? table.colWidths : 'missing';
};
const cellTexts = (fixture: ReturnType<typeof mount>) =>
  [...fixture.root.querySelectorAll('tr')].map((row) =>
    [...row.querySelectorAll('td,th')].map((cell) => cell.textContent ?? '')
  );
function cellElement(fixture: ReturnType<typeof mount>, index: number) {
  const cell = fixture.root.querySelectorAll('td,th')[index];
  if (!(cell instanceof HTMLElement)) throw new Error('Missing cell element');
  return cell;
}
const pointer = (
  type: string,
  init: PointerEventInit & { clientX?: number; clientY?: number }
) => new PointerEvent(type, { bubbles: true, cancelable: true, ...init });

test('column drag: live native resize-column per frame, pointerup keeps the width', () => {
  const flush = frames();
  const fixture = mount([['A', 'B']], [100, 100]);
  const cell = cellElement(fixture, 0);
  captureOn(fixture.root);
  const resizer = createNativeTableResizer(fixture.view);
  cleanups.push(() => resizer.dispose());
  const down = pointer('pointerdown', { clientX: 100, clientY: 5 });
  expect(resizer.start(cell, 'right', down, fixture.root)).toBe(true);
  expect(document.body.style.cursor).toBe('col-resize');
  document.dispatchEvent(pointer('pointermove', { clientX: 140, clientY: 5 }));
  flush();
  expect(widths(fixture)).toEqual([140, 100]);
  document.dispatchEvent(pointer('pointerup', { clientX: 140, clientY: 5 }));
  expect(widths(fixture)).toEqual([140, 100]);
  expect(document.body.style.cursor).toBe('');
  expect(fixture.root.hasPointerCapture(1)).toBe(false);
});

test('column drag then Escape restores the exact stored widths', () => {
  const flush = frames();
  const fixture = mount([['A', 'B']], [120, 80]);
  captureOn(fixture.root);
  const resizer = createNativeTableResizer(fixture.view);
  cleanups.push(() => resizer.dispose());
  const down = pointer('pointerdown', { clientX: 120, clientY: 5 });
  expect(
    resizer.start(cellElement(fixture, 0), 'right', down, fixture.root)
  ).toBe(true);
  document.dispatchEvent(pointer('pointermove', { clientX: 150, clientY: 5 }));
  flush();
  expect(widths(fixture)).not.toEqual([120, 80]);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(widths(fixture)).toEqual([120, 80]);
});

test('row drag then pointercancel restores the row height', () => {
  const flush = frames();
  const fixture = mount([['A'], ['B']]);
  captureOn(fixture.root);
  const resizer = createNativeTableResizer(fixture.view);
  cleanups.push(() => resizer.dispose());
  const before = fixture.view.query.serializedState();
  const down = pointer('pointerdown', { clientX: 5, clientY: 30 });
  expect(
    resizer.start(cellElement(fixture, 0), 'bottom', down, fixture.root)
  ).toBe(true);
  expect(document.body.style.cursor).toBe('row-resize');
  document.dispatchEvent(pointer('pointermove', { clientX: 5, clientY: 90 }));
  flush();
  expect(fixture.view.query.serializedState()).not.toBe(before);
  document.dispatchEvent(pointer('pointercancel', {}));
  expect(fixture.view.query.serializedState()).toBe(before);
});

test('a touch drag never changes the cursor; another pointer id is ignored', () => {
  const flush = frames();
  const fixture = mount([['A', 'B']], [100, 100]);
  const cell = cellElement(fixture, 0);
  captureOn(cell);
  const resizer = createNativeTableResizer(fixture.view);
  cleanups.push(() => resizer.dispose());
  const down = pointer('pointerdown', {
    clientX: 100,
    clientY: 5,
    pointerId: 7,
    pointerType: 'touch',
  });
  expect(resizer.start(cell, 'right', down, cell)).toBe(true);
  expect(document.body.style.cursor).toBe('');
  document.dispatchEvent(
    pointer('pointermove', { clientX: 300, clientY: 5, pointerId: 8 })
  );
  flush();
  expect(widths(fixture)).toEqual([100, 100]);
  document.dispatchEvent(
    pointer('pointermove', { clientX: 125, clientY: 5, pointerId: 7 })
  );
  flush();
  expect(widths(fixture)).toEqual([125, 100]);
});

test('move-cells moves the range contents onto the target, emptying the source', () => {
  const fixture = mount([
    ['A', 'B'],
    ['C', 'D'],
  ]);
  const keys = [...fixture.view.mirror.values()]
    .filter((node) => node.type === 'tablecell')
    .map((node) => node.key);
  const [a, , , d] = keys;
  if (a === undefined || d === undefined) throw new Error('Missing cells');
  expect(moveNativeTableCells(fixture.view, a, a, d)).toBe(true);
  expect(cellTexts(fixture)).toEqual([
    ['', 'B'],
    ['C', 'A'],
  ]);
});

test('move-cells onto a cell inside the moved range is refused and changes nothing', () => {
  const fixture = mount([
    ['A', 'B'],
    ['C', 'D'],
  ]);
  const before = fixture.view.query.serializedState();
  const keys = [...fixture.view.mirror.values()]
    .filter((node) => node.type === 'tablecell')
    .map((node) => node.key);
  const [a, b] = keys;
  if (a === undefined || b === undefined) throw new Error('Missing cells');
  moveNativeTableCells(fixture.view, a, b, b);
  expect(fixture.view.query.serializedState()).toBe(before);
});
