/** @vitest-environment jsdom */

import { render } from 'solid-js/web';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from 'vitest';
import { tableColumnResizeEdge } from '../../component/misc/TableCellResizer';
import { TableCellResizerView } from '../../component/misc/TableCellResizerView';
import { createNativeTableResizeHost } from './native-table-resize';
import {
  initializeNativeTableTests,
  nativeTableSurface,
  restoreNativeTableTests,
} from './native-table-test-fixture';

beforeAll(initializeNativeTableTests);
afterAll(restoreNativeTableTests);
/** As TableCellResizer.source.test.tsx: the resizer's width observer is inert here. */
class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => vi.stubGlobal('ResizeObserver', TestResizeObserver));

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
const CELL_WIDTH = 100;
const CELL_HEIGHT = 30;
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Laid-out cells: column i spans [i*100, i*100+100), row j spans [j*30, j*30+30). */
function layout(root: HTMLElement) {
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      const cell = this.closest('td,th');
      if (cell !== this || !root.contains(this)) return original.call(this);
      const row = this.parentElement;
      const column = row ? [...row.children].indexOf(this) : 0;
      const rowIndex = [...root.querySelectorAll('tr')].indexOf(
        row instanceof HTMLTableRowElement ? row : document.createElement('tr')
      );
      return new DOMRect(
        column * CELL_WIDTH,
        rowIndex * CELL_HEIGHT,
        CELL_WIDTH,
        CELL_HEIGHT
      );
    }
  );
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
}
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
function captureEverywhere() {
  const captured = new Set<number>();
  vi.spyOn(HTMLElement.prototype, 'setPointerCapture').mockImplementation(
    (id) => {
      captured.add(id);
    }
  );
  vi.spyOn(HTMLElement.prototype, 'releasePointerCapture').mockImplementation(
    (id) => {
      captured.delete(id);
    }
  );
  vi.spyOn(HTMLElement.prototype, 'hasPointerCapture').mockImplementation(
    (id) => captured.has(id)
  );
}

function mount(colWidths = [CELL_WIDTH, CELL_WIDTH]) {
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  for (const name of [
    'setPointerCapture',
    'releasePointerCapture',
    'hasPointerCapture',
  ] as const)
    if (!(name in HTMLElement.prototype))
      Object.defineProperty(HTMLElement.prototype, name, {
        configurable: true,
        writable: true,
        value: () => false,
      });
  captureEverywhere();
  const fixture = nativeTableSurface();
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
            colWidths,
            children: [['A', 'B']].map((cells) => ({
              type: 'tablerow',
              version: 1,
              children: cells.map((text) => ({
                type: 'tablecell',
                version: 1,
                children: [
                  {
                    type: 'paragraph',
                    version: 1,
                    children: [{ type: 'text', version: 1, text }],
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
  layout(fixture.root);
  const host = createNativeTableResizeHost(fixture.view, () => true);
  cleanups.push(() => host.dispose());
  const container = document.createElement('div');
  document.body.append(container);
  cleanups.push(() => container.remove());
  cleanups.push(render(() => <TableCellResizerView host={host} />, container));
  return Object.assign(fixture, { host });
}
type Fixture = ReturnType<typeof mount>;
function cellElement(fixture: Fixture, index: number) {
  const cell = fixture.root.querySelectorAll('td,th')[index];
  if (!(cell instanceof HTMLElement)) throw new Error('Missing cell element');
  return cell;
}
function widths(fixture: Fixture) {
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
  if (!table || typeof table !== 'object' || !('colWidths' in table))
    throw new Error('Missing widths');
  return table.colWidths;
}
const pointer = (type: string, init: PointerEventInit) =>
  new PointerEvent(type, { bubbles: true, cancelable: true, ...init });
const touchMove = (clientX: number, clientY: number) =>
  Object.defineProperty(
    new TouchEvent('touchmove', { bubbles: true, cancelable: true }),
    'touches',
    { value: [{ clientX, clientY }] }
  );
const TOUCH = { pointerId: 5, pointerType: 'touch', isPrimary: true };

test('touch: a horizontal first move from near a column border resizes that column', () => {
  const flush = frames();
  const fixture = mount();
  const cell = cellElement(fixture, 0);
  cell.dispatchEvent(
    pointer('pointerdown', { ...TOUCH, clientX: 95, clientY: 10 })
  );
  const first = touchMove(115, 12);
  document.dispatchEvent(first);
  expect(first.defaultPrevented).toBe(true);
  document.dispatchEvent(
    pointer('pointermove', { ...TOUCH, clientX: 135, clientY: 12 })
  );
  flush();
  expect(widths(fixture)).toEqual([140, 100]);
  document.dispatchEvent(
    pointer('pointerup', { ...TOUCH, clientX: 135, clientY: 12 })
  );
  expect(widths(fixture)).toEqual([140, 100]);
});

test('touch: a mostly vertical first move is left to the browser as a scroll', () => {
  const flush = frames();
  const fixture = mount();
  cellElement(fixture, 0).dispatchEvent(
    pointer('pointerdown', { ...TOUCH, clientX: 95, clientY: 10 })
  );
  const first = touchMove(100, 40);
  document.dispatchEvent(first);
  expect(first.defaultPrevented).toBe(false);
  document.dispatchEvent(
    pointer('pointermove', { ...TOUCH, clientX: 140, clientY: 40 })
  );
  flush();
  expect(widths(fixture)).toEqual([100, 100]);
});

test('touch: a still finger disarms after 350ms, before the long-press selection', () => {
  vi.useFakeTimers();
  const flush = frames();
  const fixture = mount();
  cellElement(fixture, 0).dispatchEvent(
    pointer('pointerdown', { ...TOUCH, clientX: 95, clientY: 10 })
  );
  vi.advanceTimersByTime(350);
  const late = touchMove(130, 10);
  document.dispatchEvent(late);
  expect(late.defaultPrevented).toBe(false);
  document.dispatchEvent(
    pointer('pointermove', { ...TOUCH, clientX: 140, clientY: 10 })
  );
  flush();
  expect(widths(fixture)).toEqual([100, 100]);
});

test('touch: a press away from any column border never arms', () => {
  const flush = frames();
  const fixture = mount();
  cellElement(fixture, 0).dispatchEvent(
    pointer('pointerdown', { ...TOUCH, clientX: 50, clientY: 10 })
  );
  const first = touchMove(80, 10);
  document.dispatchEvent(first);
  expect(first.defaultPrevented).toBe(false);
  flush();
  expect(widths(fixture)).toEqual([100, 100]);
});

test('(d) tableColumnResizeEdge names the dragged border during a strip drag and clears after', () => {
  const flush = frames();
  const fixture = mount();
  cellElement(fixture, 0).dispatchEvent(
    pointer('pointermove', { clientX: 50, clientY: 10 })
  );
  const strip = document.querySelector('.cursor-col-resize');
  if (!(strip instanceof HTMLElement)) throw new Error('Missing column strip');
  strip.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 10 }));
  expect(tableColumnResizeEdge()).toBe('right');
  document.dispatchEvent(pointer('pointermove', { clientX: 130, clientY: 10 }));
  flush();
  expect(widths(fixture)).toEqual([130, 100]);
  document.dispatchEvent(pointer('pointerup', { clientX: 130, clientY: 10 }));
  expect(tableColumnResizeEdge()).toBeUndefined();
});

test('hover: the row strip resizes the hovered row and Escape restores it', async () => {
  const flush = frames();
  const fixture = mount();
  const before = fixture.view.query.serializedState();
  cellElement(fixture, 0).dispatchEvent(
    pointer('pointermove', { clientX: 50, clientY: 10 })
  );
  const strip = document.querySelector('.cursor-row-resize');
  if (!(strip instanceof HTMLElement)) throw new Error('Missing row strip');
  strip.dispatchEvent(pointer('pointerdown', { clientX: 50, clientY: 30 }));
  expect(document.body.style.cursor).toBe('row-resize');
  document.dispatchEvent(pointer('pointermove', { clientX: 50, clientY: 70 }));
  flush();
  await fixture.host.settled();
  expect(fixture.view.query.serializedState()).not.toBe(before);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  // The restore is a queued SessionEdit input; settled() is its real fence.
  await fixture.host.settled();
  expect(fixture.view.query.serializedState()).toBe(before);
  expect(document.body.style.cursor).toBe('');
});
