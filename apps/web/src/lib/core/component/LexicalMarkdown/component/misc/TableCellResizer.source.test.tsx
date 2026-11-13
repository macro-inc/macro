/** @vitest-environment jsdom */
import { writeFileSync } from 'node:fs';
import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import {
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  $isTableSelection,
} from '@lexical/table';
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
  UNDO_COMMAND,
} from 'lexical';
import { render } from 'solid-js/web';
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  type LexicalWrapper,
  LexicalWrapperContext,
} from '../../context/LexicalWrapperContext';
import { createPluginManager } from '../../plugins';
import {
  buildTable,
  coordGrid,
  createTableTestEditor,
} from '../../plugins/tables/tableTestUtils';
import { TableCellResizer, tableColumnResizeEdge } from './TableCellResizer';

const touchDevice = vi.hoisted(() => vi.fn(() => false));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: touchDevice }));

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
class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const CELL_WIDTH = 100;
const CELL_HEIGHT = 30;
const record: Record<string, unknown[]> = {};
const cleanups: Array<() => void> = [];
let frames = new Map<number, FrameRequestCallback>();
let events: string[] = [];

beforeEach(() => {
  touchDevice.mockReturnValue(false);
  frames = new Map();
  events = [];
  let nextFrame = 1;
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    events.push(`raf:${nextFrame}`);
    frames.set(nextFrame, callback);
    return nextFrame++;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    events.push(`caf:${id}`);
    frames.delete(id);
  });
  const captured = new Set<number>();
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
  vi.spyOn(HTMLElement.prototype, 'setPointerCapture').mockImplementation(
    function (this: HTMLElement, id) {
      events.push(
        `capture:${id}:${this.tagName}:edge=${tableColumnResizeEdge() ?? '-'}`
      );
      captured.add(id);
    }
  );
  vi.spyOn(HTMLElement.prototype, 'releasePointerCapture').mockImplementation(
    (id) => {
      events.push(`release:${id}`);
      captured.delete(id);
    }
  );
  vi.spyOn(HTMLElement.prototype, 'hasPointerCapture').mockImplementation(
    (id) => captured.has(id)
  );
  const add = document.addEventListener.bind(document);
  const remove = document.removeEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation(
    (type, listener, options) => {
      events.push(`doc+${type}:${JSON.stringify(options ?? null)}`);
      add(type, listener, options);
    }
  );
  vi.spyOn(document, 'removeEventListener').mockImplementation(
    (type, listener, options) => {
      events.push(`doc-${type}:${JSON.stringify(options ?? null)}`);
      remove(type, listener, options);
    }
  );
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      const rows = [...document.querySelectorAll('tr')];
      if (this instanceof HTMLTableRowElement) {
        const rowIndex = rows.indexOf(this);
        return new DOMRect(0, rowIndex * CELL_HEIGHT, 200, CELL_HEIGHT);
      }
      if (this instanceof HTMLTableCellElement) {
        const row = this.parentElement;
        const column = row ? [...row.children].indexOf(this) : 0;
        const rowIndex =
          row instanceof HTMLTableRowElement ? rows.indexOf(row) : 0;
        return new DOMRect(
          column * CELL_WIDTH,
          rowIndex * CELL_HEIGHT,
          CELL_WIDTH,
          CELL_HEIGHT
        );
      }
      return original.call(this);
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
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  document.body.innerHTML = '';
  document.body.style.cursor = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(() => {
  const out = process.env.TABLE_SOURCE_CONTROL_OUT;
  if (out) writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
  const checkedOut = process.env.TABLE_SOURCE_CHECKED_OUT;
  if (checkedOut)
    writeFileSync(checkedOut, `${JSON.stringify(checked, null, 2)}\n`);
});

const flushFrames = () => {
  const pending = [...frames.entries()];
  frames.clear();
  for (const [id, callback] of pending) {
    events.push(`frame:${id}`);
    callback(0);
  }
};
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const pointer = (type: string, init: PointerEventInit) =>
  new PointerEvent(type, { bubbles: true, cancelable: true, ...init });
const touchMove = (clientX: number, clientY: number) =>
  Object.defineProperty(
    new TouchEvent('touchmove', { bubbles: true, cancelable: true }),
    'touches',
    { value: [{ clientX, clientY }] }
  );
const TOUCH = { pointerId: 5, pointerType: 'touch', isPrimary: true };

async function mount() {
  const editor = createTableTestEditor();
  cleanups.push(registerHistory(editor, createEmptyHistoryState(), 0));
  await buildTable(editor, coordGrid(2, 2));
  const tags: string[][] = [];
  cleanups.push(
    editor.registerUpdateListener(({ tags: updateTags, dirtyElements }) => {
      if (dirtyElements.size > 0) tags.push([...updateTags].sort());
    })
  );
  const wrapper: LexicalWrapper = {
    type: 'markdown',
    owner: null,
    plugins: createPluginManager(editor, 'markdown'),
    editor,
    cleanup: () => {},
    isInteractable: () => true,
  };
  const container = document.createElement('div');
  container.id = 'mount';
  document.body.append(container);
  cleanups.push(
    render(
      () => (
        <LexicalWrapperContext.Provider value={wrapper}>
          <TableCellResizer />
        </LexicalWrapperContext.Provider>
      ),
      container
    )
  );
  return { editor, tags };
}

function cell(editor: LexicalEditor, index: number) {
  const element = editor.getRootElement()?.querySelectorAll('td,th')[index];
  if (!(element instanceof HTMLElement)) throw new Error('Missing cell');
  return element;
}

/** The recorded snapshot without the raw model, plus a compact table digest. */
type Checked = Record<string, unknown>;
const checked: Record<string, Checked[]> = {};

/** Root children as types and text; tables as widths, heights, spans and text. */
function $digest() {
  return $getRoot()
    .getChildren()
    .map((node) => {
      if (!$isTableNode(node))
        return { type: node.getType(), text: node.getTextContent() };
      return {
        type: 'table',
        colWidths: node.getColWidths() ?? null,
        rows: node
          .getChildren()
          .filter($isTableRowNode)
          .map((row) => ({
            height: row.getHeight() ?? null,
            cells: row
              .getChildren()
              .filter($isTableCellNode)
              .map((cell) => ({
                text: cell.getTextContent(),
                colSpan: cell.getColSpan(),
                rowSpan: cell.getRowSpan(),
              })),
          })),
      };
    });
}

function snapshot(
  name: string,
  label: string,
  editor: LexicalEditor,
  tags: string[][],
  extra: Record<string, unknown> = {}
) {
  const selection = editor.getEditorState().read(() => {
    const current = $getSelection();
    if ($isTableSelection(current))
      return {
        kind: 'table',
        anchor: current.anchor.key,
        focus: current.focus.key,
      };
    if ($isRangeSelection(current))
      return {
        kind: 'range',
        anchor: current.anchor.key,
        offset: current.anchor.offset,
      };
    return { kind: current ? 'other' : 'none' };
  });
  const portal = [...document.body.children]
    .filter((element) => element !== editor.getRootElement())
    .map((element) => element.outerHTML);
  const entries = record[name] ?? [];
  record[name] = entries;
  const entry = {
    label,
    selection,
    portal,
    cursor: document.body.style.cursor,
    edge: tableColumnResizeEdge() ?? null,
    tags: tags.splice(0),
    events: events.splice(0),
    ...extra,
  };
  entries.push({ ...entry, model: editor.getEditorState().toJSON() });
  const checks = checked[name] ?? [];
  checked[name] = checks;
  checks.push({ ...entry, model: editor.getEditorState().read($digest) });
}

test('hover column strip drag applies live, merges history, undoes in one step', async () => {
  const { editor, tags } = await mount();
  snapshot('column-drag', 'mounted', editor, tags);
  cell(editor, 0).dispatchEvent(
    pointer('pointermove', { clientX: 50, clientY: 10 })
  );
  snapshot('column-drag', 'hovered', editor, tags);
  const strip = document.querySelector('.cursor-col-resize');
  if (!(strip instanceof HTMLElement)) throw new Error('Missing column strip');
  const down = pointer('pointerdown', { clientX: 100, clientY: 10 });
  strip.dispatchEvent(down);
  snapshot('column-drag', 'down', editor, tags, {
    defaultPrevented: down.defaultPrevented,
  });
  const move = pointer('pointermove', { clientX: 130, clientY: 10 });
  document.dispatchEvent(move);
  document.dispatchEvent(pointer('pointermove', { clientX: 140, clientY: 10 }));
  snapshot('column-drag', 'moved-before-frame', editor, tags, {
    defaultPrevented: move.defaultPrevented,
  });
  flushFrames();
  await settle();
  snapshot('column-drag', 'frame-1', editor, tags);
  document.dispatchEvent(pointer('pointermove', { clientX: 170, clientY: 10 }));
  flushFrames();
  await settle();
  snapshot('column-drag', 'frame-2', editor, tags);
  document.dispatchEvent(pointer('pointermove', { clientX: 180, clientY: 10 }));
  document.dispatchEvent(pointer('pointerup', { clientX: 180, clientY: 10 }));
  await settle();
  snapshot('column-drag', 'up-flushes-pending-frame', editor, tags);
  editor.dispatchCommand(UNDO_COMMAND, undefined);
  await settle();
  snapshot('column-drag', 'undo', editor, tags);
  expect(tableColumnResizeEdge()).toBeUndefined();
  expect(checked['column-drag']).toEqual([
    {
      label: 'mounted',
      selection: { kind: 'none' },
      portal: ['<div id="mount"></div>'],
      cursor: '',
      edge: null,
      tags: [],
      events: [
        'doc+selectionchange:null',
        'doc+mouseover:true',
        'doc+mouseout:true',
        'doc+scroll:{"capture":true,"passive":true}',
      ],
      model: [
        {
          type: 'table',
          colWidths: null,
          rows: [
            {
              height: null,
              cells: [
                { text: '0,0', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
    },
    {
      label: 'hovered',
      selection: { kind: 'none' },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div class="group fixed z-20 flex cursor-col-resize touch-none justify-center" style="width: 9px; left: 95.5px; top: 0px; height: 30px;"><div class="h-full w-[3px] bg-accent transition-opacity opacity-0 group-hover:opacity-70"></div></div><div class="group fixed z-20 flex cursor-row-resize touch-none items-center" style="height: 9px; left: 0px; top: 25.5px; width: 91px;"><div class="h-[3px] w-full bg-accent transition-opacity opacity-0 group-hover:opacity-70"></div></div></div>',
      ],
      cursor: '',
      edge: null,
      tags: [],
      events: [],
      model: [
        {
          type: 'table',
          colWidths: null,
          rows: [
            {
              height: null,
              cells: [
                { text: '0,0', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
    },
    {
      label: 'down',
      selection: { kind: 'none' },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div class="group fixed z-20 flex cursor-col-resize touch-none justify-center" style="width: 9px; left: 95.5px; top: 0px; height: 30px;"><div class="h-full w-[3px] bg-accent transition-opacity opacity-100"></div></div></div>',
      ],
      cursor: 'col-resize',
      edge: 'right',
      tags: [],
      events: [
        'capture:1:DIV:edge=-',
        'doc+pointermove:null',
        'doc+pointerup:null',
        'doc+pointercancel:null',
        'doc+keydown:null',
      ],
      defaultPrevented: true,
      model: [
        {
          type: 'table',
          colWidths: null,
          rows: [
            {
              height: null,
              cells: [
                { text: '0,0', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
    },
    {
      label: 'moved-before-frame',
      selection: { kind: 'none' },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div class="group fixed z-20 flex cursor-col-resize touch-none justify-center" style="width: 9px; left: 95.5px; top: 0px; height: 30px;"><div class="h-full w-[3px] bg-accent transition-opacity opacity-100"></div></div></div>',
      ],
      cursor: 'col-resize',
      edge: 'right',
      tags: [],
      events: ['raf:1'],
      defaultPrevented: true,
      model: [
        {
          type: 'table',
          colWidths: null,
          rows: [
            {
              height: null,
              cells: [
                { text: '0,0', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
    },
    {
      label: 'frame-1',
      selection: { kind: 'none' },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div class="group fixed z-20 flex cursor-col-resize touch-none justify-center" style="width: 9px; left: 95.5px; top: 0px; height: 30px;"><div class="h-full w-[3px] bg-accent transition-opacity opacity-100"></div></div></div>',
      ],
      cursor: 'col-resize',
      edge: 'right',
      tags: [['skip-scroll-into-view']],
      events: ['frame:1'],
      model: [
        {
          type: 'table',
          colWidths: [140, 100],
          rows: [
            {
              height: null,
              cells: [
                { text: '0,0', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
    },
    {
      label: 'frame-2',
      selection: { kind: 'none' },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div class="group fixed z-20 flex cursor-col-resize touch-none justify-center" style="width: 9px; left: 95.5px; top: 0px; height: 30px;"><div class="h-full w-[3px] bg-accent transition-opacity opacity-100"></div></div></div>',
      ],
      cursor: 'col-resize',
      edge: 'right',
      tags: [['history-merge', 'skip-scroll-into-view']],
      events: ['raf:2', 'frame:2'],
      model: [
        {
          type: 'table',
          colWidths: [170, 100],
          rows: [
            {
              height: null,
              cells: [
                { text: '0,0', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
    },
    {
      label: 'up-flushes-pending-frame',
      selection: { kind: 'none' },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div class="group fixed z-20 flex cursor-col-resize touch-none justify-center" style="width: 9px; left: 95.5px; top: 0px; height: 30px;"><div class="h-full w-[3px] bg-accent transition-opacity opacity-0 group-hover:opacity-70"></div></div><div class="group fixed z-20 flex cursor-row-resize touch-none items-center" style="height: 9px; left: 0px; top: 25.5px; width: 91px;"><div class="h-[3px] w-full bg-accent transition-opacity opacity-0 group-hover:opacity-70"></div></div></div>',
      ],
      cursor: '',
      edge: null,
      tags: [['history-merge', 'skip-scroll-into-view']],
      events: [
        'raf:3',
        'caf:3',
        'release:1',
        'doc-pointermove:null',
        'doc-pointerup:null',
        'doc-pointercancel:null',
        'doc-touchmove:null',
        'doc-keydown:null',
      ],
      model: [
        {
          type: 'table',
          colWidths: [180, 100],
          rows: [
            {
              height: null,
              cells: [
                { text: '0,0', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
    },
    {
      label: 'undo',
      selection: { kind: 'none' },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div class="group fixed z-20 flex cursor-col-resize touch-none justify-center" style="width: 9px; left: 95.5px; top: 0px; height: 30px;"><div class="h-full w-[3px] bg-accent transition-opacity opacity-0 group-hover:opacity-70"></div></div><div class="group fixed z-20 flex cursor-row-resize touch-none items-center" style="height: 9px; left: 0px; top: 25.5px; width: 91px;"><div class="h-[3px] w-full bg-accent transition-opacity opacity-0 group-hover:opacity-70"></div></div></div>',
      ],
      cursor: '',
      edge: null,
      tags: [['historic']],
      events: [],
      model: [
        {
          type: 'table',
          colWidths: null,
          rows: [
            {
              height: null,
              cells: [
                { text: '0,0', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
    },
  ]);
});

test('non-primary mouse button on the strip is ignored', async () => {
  const { editor, tags } = await mount();
  cell(editor, 1).dispatchEvent(
    pointer('pointermove', { clientX: 150, clientY: 10 })
  );
  const strip = document.querySelector('.cursor-col-resize');
  if (!(strip instanceof HTMLElement)) throw new Error('Missing column strip');
  const down = pointer('pointerdown', { clientX: 200, clientY: 10, button: 2 });
  strip.dispatchEvent(down);
  snapshot('right-button', 'down', editor, tags, {
    defaultPrevented: down.defaultPrevented,
  });
  expect(checked['right-button']).toEqual([
    {
      label: 'down',
      selection: { kind: 'none' },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div class="group fixed z-20 flex cursor-col-resize touch-none justify-center" style="width: 9px; left: 195.5px; top: 0px; height: 30px;"><div class="h-full w-[3px] bg-accent transition-opacity opacity-0 group-hover:opacity-70"></div></div><div class="group fixed z-20 flex cursor-row-resize touch-none items-center" style="height: 9px; left: 100px; top: 25.5px; width: 91px;"><div class="h-[3px] w-full bg-accent transition-opacity opacity-0 group-hover:opacity-70"></div></div></div>',
      ],
      cursor: '',
      edge: null,
      tags: [],
      events: ['doc+scroll:{"capture":true,"passive":true}'],
      defaultPrevented: false,
      model: [
        {
          type: 'table',
          colWidths: null,
          rows: [
            {
              height: null,
              cells: [
                { text: '0,0', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
    },
  ]);
});

test('row strip drag, then Escape restores the height', async () => {
  const { editor, tags } = await mount();
  cell(editor, 0).dispatchEvent(
    pointer('pointermove', { clientX: 50, clientY: 10 })
  );
  const strip = document.querySelector('.cursor-row-resize');
  if (!(strip instanceof HTMLElement)) throw new Error('Missing row strip');
  strip.dispatchEvent(pointer('pointerdown', { clientX: 50, clientY: 30 }));
  snapshot('row-escape', 'down', editor, tags);
  document.dispatchEvent(pointer('pointermove', { clientX: 50, clientY: 70 }));
  flushFrames();
  await settle();
  snapshot('row-escape', 'frame', editor, tags);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await settle();
  snapshot('row-escape', 'escape', editor, tags);
  cell(editor, 2).dispatchEvent(
    pointer('pointermove', { clientX: 50, clientY: 40 })
  );
  snapshot('row-escape', 'hover-next-row', editor, tags);
  expect(checked['row-escape']).toEqual([
    {
      label: 'down',
      selection: { kind: 'none' },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div class="group fixed z-20 flex cursor-row-resize touch-none items-center" style="height: 9px; left: 0px; top: 25.5px; width: 100px;"><div class="h-[3px] w-full bg-accent transition-opacity opacity-100"></div></div></div>',
      ],
      cursor: 'row-resize',
      edge: 'bottom',
      tags: [],
      events: [
        'doc+scroll:{"capture":true,"passive":true}',
        'capture:1:DIV:edge=-',
        'doc+pointermove:null',
        'doc+pointerup:null',
        'doc+pointercancel:null',
        'doc+keydown:null',
      ],
      model: [
        {
          type: 'table',
          colWidths: null,
          rows: [
            {
              height: null,
              cells: [
                { text: '0,0', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
    },
    {
      label: 'frame',
      selection: { kind: 'none' },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div class="group fixed z-20 flex cursor-row-resize touch-none items-center" style="height: 9px; left: 0px; top: 25.5px; width: 100px;"><div class="h-[3px] w-full bg-accent transition-opacity opacity-100"></div></div></div>',
      ],
      cursor: 'row-resize',
      edge: 'bottom',
      tags: [['skip-scroll-into-view']],
      events: ['raf:1', 'frame:1'],
      model: [
        {
          type: 'table',
          colWidths: null,
          rows: [
            {
              height: 70,
              cells: [
                { text: '0,0', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
    },
    {
      label: 'escape',
      selection: { kind: 'none' },
      portal: ['<div id="mount"></div>'],
      cursor: '',
      edge: null,
      tags: [['history-merge', 'skip-scroll-into-view']],
      events: [
        'release:1',
        'doc-pointermove:null',
        'doc-pointerup:null',
        'doc-pointercancel:null',
        'doc-touchmove:null',
        'doc-keydown:null',
      ],
      model: [
        {
          type: 'table',
          colWidths: null,
          rows: [
            {
              height: null,
              cells: [
                { text: '0,0', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
    },
    {
      label: 'hover-next-row',
      selection: { kind: 'none' },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div class="group fixed z-20 flex cursor-col-resize touch-none justify-center" style="width: 9px; left: 95.5px; top: 30px; height: 30px;"><div class="h-full w-[3px] bg-accent transition-opacity opacity-0 group-hover:opacity-70"></div></div><div class="group fixed z-20 flex cursor-row-resize touch-none items-center" style="height: 9px; left: 0px; top: 55.5px; width: 91px;"><div class="h-[3px] w-full bg-accent transition-opacity opacity-0 group-hover:opacity-70"></div></div></div>',
      ],
      cursor: '',
      edge: null,
      tags: [],
      events: [],
      model: [
        {
          type: 'table',
          colWidths: null,
          rows: [
            {
              height: null,
              cells: [
                { text: '0,0', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
    },
  ]);
});

test('Escape before any frame does not revert; pointercancel after a frame does', async () => {
  const { editor, tags } = await mount();
  cell(editor, 0).dispatchEvent(
    pointer('pointermove', { clientX: 50, clientY: 10 })
  );
  const strip = document.querySelector('.cursor-col-resize');
  if (!(strip instanceof HTMLElement)) throw new Error('Missing column strip');
  strip.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 10 }));
  document.dispatchEvent(pointer('pointermove', { clientX: 130, clientY: 10 }));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await settle();
  snapshot('cancel', 'escape-before-frame', editor, tags);
  const again = document.querySelector('.cursor-col-resize');
  if (!(again instanceof HTMLElement)) throw new Error('Missing column strip');
  again.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 10 }));
  document.dispatchEvent(pointer('pointermove', { clientX: 150, clientY: 10 }));
  flushFrames();
  await settle();
  snapshot('cancel', 'frame', editor, tags);
  document.dispatchEvent(pointer('pointercancel', { pointerId: 9 }));
  snapshot('cancel', 'foreign-cancel-ignored', editor, tags);
  document.dispatchEvent(
    pointer('pointercancel', { clientX: 150, clientY: 10 })
  );
  await settle();
  snapshot('cancel', 'cancel', editor, tags);
  expect(checked['cancel']).toEqual([
    {
      label: 'escape-before-frame',
      selection: { kind: 'none' },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div class="group fixed z-20 flex cursor-col-resize touch-none justify-center" style="width: 9px; left: 95.5px; top: 0px; height: 30px;"><div class="h-full w-[3px] bg-accent transition-opacity opacity-0 group-hover:opacity-70"></div></div><div class="group fixed z-20 flex cursor-row-resize touch-none items-center" style="height: 9px; left: 0px; top: 25.5px; width: 91px;"><div class="h-[3px] w-full bg-accent transition-opacity opacity-0 group-hover:opacity-70"></div></div></div>',
      ],
      cursor: '',
      edge: null,
      tags: [],
      events: [
        'doc+scroll:{"capture":true,"passive":true}',
        'capture:1:DIV:edge=-',
        'doc+pointermove:null',
        'doc+pointerup:null',
        'doc+pointercancel:null',
        'doc+keydown:null',
        'raf:1',
        'caf:1',
        'release:1',
        'doc-pointermove:null',
        'doc-pointerup:null',
        'doc-pointercancel:null',
        'doc-touchmove:null',
        'doc-keydown:null',
      ],
      model: [
        {
          type: 'table',
          colWidths: null,
          rows: [
            {
              height: null,
              cells: [
                { text: '0,0', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
    },
    {
      label: 'frame',
      selection: { kind: 'none' },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div class="group fixed z-20 flex cursor-col-resize touch-none justify-center" style="width: 9px; left: 95.5px; top: 0px; height: 30px;"><div class="h-full w-[3px] bg-accent transition-opacity opacity-100"></div></div></div>',
      ],
      cursor: 'col-resize',
      edge: 'right',
      tags: [['skip-scroll-into-view']],
      events: [
        'capture:1:DIV:edge=-',
        'doc+pointermove:null',
        'doc+pointerup:null',
        'doc+pointercancel:null',
        'doc+keydown:null',
        'raf:2',
        'frame:2',
      ],
      model: [
        {
          type: 'table',
          colWidths: [150, 100],
          rows: [
            {
              height: null,
              cells: [
                { text: '0,0', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
    },
    {
      label: 'foreign-cancel-ignored',
      selection: { kind: 'none' },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div class="group fixed z-20 flex cursor-col-resize touch-none justify-center" style="width: 9px; left: 95.5px; top: 0px; height: 30px;"><div class="h-full w-[3px] bg-accent transition-opacity opacity-100"></div></div></div>',
      ],
      cursor: 'col-resize',
      edge: 'right',
      tags: [],
      events: [],
      model: [
        {
          type: 'table',
          colWidths: [150, 100],
          rows: [
            {
              height: null,
              cells: [
                { text: '0,0', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
    },
    {
      label: 'cancel',
      selection: { kind: 'none' },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div class="group fixed z-20 flex cursor-col-resize touch-none justify-center" style="width: 9px; left: 95.5px; top: 0px; height: 30px;"><div class="h-full w-[3px] bg-accent transition-opacity opacity-0 group-hover:opacity-70"></div></div><div class="group fixed z-20 flex cursor-row-resize touch-none items-center" style="height: 9px; left: 0px; top: 25.5px; width: 91px;"><div class="h-[3px] w-full bg-accent transition-opacity opacity-0 group-hover:opacity-70"></div></div></div>',
      ],
      cursor: '',
      edge: null,
      tags: [['history-merge', 'skip-scroll-into-view']],
      events: [
        'release:1',
        'doc-pointermove:null',
        'doc-pointerup:null',
        'doc-pointercancel:null',
        'doc-touchmove:null',
        'doc-keydown:null',
      ],
      model: [
        {
          type: 'table',
          colWidths: null,
          rows: [
            {
              height: null,
              cells: [
                { text: '0,0', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
    },
  ]);
});

test('touch: horizontal swipe from a border arms and resizes', async () => {
  touchDevice.mockReturnValue(true);
  const { editor, tags } = await mount();
  snapshot('touch-swipe', 'mounted', editor, tags);
  const down = pointer('pointerdown', { ...TOUCH, clientX: 95, clientY: 10 });
  cell(editor, 0).dispatchEvent(down);
  snapshot('touch-swipe', 'armed', editor, tags, {
    defaultPrevented: down.defaultPrevented,
  });
  const first = touchMove(115, 12);
  document.dispatchEvent(first);
  snapshot('touch-swipe', 'first-touchmove', editor, tags, {
    defaultPrevented: first.defaultPrevented,
  });
  const second = touchMove(125, 12);
  document.dispatchEvent(second);
  document.dispatchEvent(
    pointer('pointermove', { ...TOUCH, clientX: 145, clientY: 12 })
  );
  flushFrames();
  await settle();
  snapshot('touch-swipe', 'frame', editor, tags, {
    blocked: second.defaultPrevented,
  });
  document.dispatchEvent(
    pointer('pointerup', { ...TOUCH, clientX: 145, clientY: 12 })
  );
  await settle();
  snapshot('touch-swipe', 'up', editor, tags);
  expect(checked['touch-swipe']).toEqual([
    {
      label: 'mounted',
      selection: { kind: 'none' },
      portal: ['<div id="mount"></div>'],
      cursor: '',
      edge: null,
      tags: [],
      events: ['doc+scroll:{"capture":true,"passive":true}'],
      model: [
        {
          type: 'table',
          colWidths: null,
          rows: [
            {
              height: null,
              cells: [
                { text: '0,0', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
    },
    {
      label: 'armed',
      selection: { kind: 'none' },
      portal: ['<div id="mount"></div>'],
      cursor: '',
      edge: null,
      tags: [],
      events: [
        'doc+pointermove:null',
        'doc+pointerup:null',
        'doc+pointercancel:null',
        'doc+touchmove:{"passive":false}',
        'doc+pointerup:null',
        'doc+pointercancel:null',
      ],
      defaultPrevented: false,
      model: [
        {
          type: 'table',
          colWidths: null,
          rows: [
            {
              height: null,
              cells: [
                { text: '0,0', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
    },
    {
      label: 'first-touchmove',
      selection: { kind: 'none' },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div class="group fixed z-20 flex cursor-col-resize touch-none justify-center" style="width: 9px; left: 95.5px; top: 0px; height: 30px;"><div class="h-full w-[3px] bg-accent transition-opacity opacity-100"></div></div></div>',
      ],
      cursor: '',
      edge: 'right',
      tags: [],
      events: [
        'doc-touchmove:null',
        'doc-pointerup:null',
        'doc-pointercancel:null',
        'capture:5:TD:edge=-',
        'doc+pointermove:null',
        'doc+pointerup:null',
        'doc+pointercancel:null',
        'doc+touchmove:{"passive":false}',
        'doc+keydown:null',
      ],
      defaultPrevented: true,
      model: [
        {
          type: 'table',
          colWidths: null,
          rows: [
            {
              height: null,
              cells: [
                { text: '0,0', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
    },
    {
      label: 'frame',
      selection: { kind: 'none' },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div class="group fixed z-20 flex cursor-col-resize touch-none justify-center" style="width: 9px; left: 95.5px; top: 0px; height: 30px;"><div class="h-full w-[3px] bg-accent transition-opacity opacity-100"></div></div></div>',
      ],
      cursor: '',
      edge: 'right',
      tags: [['skip-scroll-into-view']],
      events: ['raf:1', 'frame:1'],
      blocked: true,
      model: [
        {
          type: 'table',
          colWidths: [150, 100],
          rows: [
            {
              height: null,
              cells: [
                { text: '0,0', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
    },
    {
      label: 'up',
      selection: { kind: 'none' },
      portal: ['<div id="mount"></div>'],
      cursor: '',
      edge: null,
      tags: [],
      events: [
        'doc-pointermove:null',
        'doc-pointerup:null',
        'doc-pointercancel:null',
        'release:5',
        'doc-pointermove:null',
        'doc-pointerup:null',
        'doc-pointercancel:null',
        'doc-touchmove:null',
        'doc-keydown:null',
      ],
      model: [
        {
          type: 'table',
          colWidths: [150, 100],
          rows: [
            {
              height: null,
              cells: [
                { text: '0,0', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
    },
  ]);
});

test('touch: left border, vertical first move, still finger, and away from border', async () => {
  touchDevice.mockReturnValue(true);
  const { editor, tags } = await mount();
  cell(editor, 1).dispatchEvent(
    pointer('pointerdown', { ...TOUCH, clientX: 105, clientY: 10 })
  );
  document.dispatchEvent(touchMove(90, 10));
  document.dispatchEvent(
    pointer('pointermove', { ...TOUCH, clientX: 70, clientY: 10 })
  );
  flushFrames();
  await settle();
  snapshot('touch-misc', 'left-edge-frame', editor, tags);
  document.dispatchEvent(
    pointer('pointerup', { ...TOUCH, clientX: 70, clientY: 10 })
  );
  await settle();
  snapshot('touch-misc', 'left-edge-up', editor, tags);

  cell(editor, 0).dispatchEvent(
    pointer('pointerdown', { ...TOUCH, clientX: 95, clientY: 10 })
  );
  const vertical = touchMove(100, 40);
  document.dispatchEvent(vertical);
  snapshot('touch-misc', 'vertical', editor, tags, {
    defaultPrevented: vertical.defaultPrevented,
  });
  document.dispatchEvent(
    pointer('pointerup', { ...TOUCH, clientX: 100, clientY: 40 })
  );

  vi.useFakeTimers();
  cell(editor, 0).dispatchEvent(
    pointer('pointerdown', { ...TOUCH, clientX: 95, clientY: 10 })
  );
  vi.advanceTimersByTime(349);
  snapshot('touch-misc', 'still-349', editor, tags);
  vi.advanceTimersByTime(1);
  const late = touchMove(130, 10);
  document.dispatchEvent(late);
  snapshot('touch-misc', 'still-350', editor, tags, {
    defaultPrevented: late.defaultPrevented,
  });
  vi.useRealTimers();

  cell(editor, 0).dispatchEvent(
    pointer('pointerdown', { ...TOUCH, clientX: 50, clientY: 10 })
  );
  const away = touchMove(80, 10);
  document.dispatchEvent(away);
  snapshot('touch-misc', 'away', editor, tags, {
    defaultPrevented: away.defaultPrevented,
  });
  cell(editor, 0).dispatchEvent(
    pointer('pointerdown', {
      ...TOUCH,
      clientX: 95,
      clientY: 10,
      isPrimary: false,
    })
  );
  snapshot('touch-misc', 'non-primary', editor, tags);
  editor.setEditable(false);
  cell(editor, 0).dispatchEvent(
    pointer('pointerdown', { ...TOUCH, clientX: 95, clientY: 10 })
  );
  snapshot('touch-misc', 'read-only', editor, tags);
  expect(checked['touch-misc']).toEqual([
    {
      label: 'left-edge-frame',
      selection: { kind: 'none' },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div class="group fixed z-20 flex cursor-col-resize touch-none justify-center" style="width: 9px; left: 95.5px; top: 0px; height: 30px;"><div class="h-full w-[3px] bg-accent transition-opacity opacity-100"></div></div></div>',
      ],
      cursor: '',
      edge: 'left',
      tags: [['skip-scroll-into-view']],
      events: [
        'doc+scroll:{"capture":true,"passive":true}',
        'doc+pointermove:null',
        'doc+pointerup:null',
        'doc+pointercancel:null',
        'doc+touchmove:{"passive":false}',
        'doc+pointerup:null',
        'doc+pointercancel:null',
        'doc-touchmove:null',
        'doc-pointerup:null',
        'doc-pointercancel:null',
        'capture:5:TD:edge=-',
        'doc+pointermove:null',
        'doc+pointerup:null',
        'doc+pointercancel:null',
        'doc+touchmove:{"passive":false}',
        'doc+keydown:null',
        'raf:1',
        'frame:1',
      ],
      model: [
        {
          type: 'table',
          colWidths: [120, 100],
          rows: [
            {
              height: null,
              cells: [
                { text: '0,0', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
    },
    {
      label: 'left-edge-up',
      selection: { kind: 'none' },
      portal: ['<div id="mount"></div>'],
      cursor: '',
      edge: null,
      tags: [],
      events: [
        'doc-pointermove:null',
        'doc-pointerup:null',
        'doc-pointercancel:null',
        'release:5',
        'doc-pointermove:null',
        'doc-pointerup:null',
        'doc-pointercancel:null',
        'doc-touchmove:null',
        'doc-keydown:null',
      ],
      model: [
        {
          type: 'table',
          colWidths: [120, 100],
          rows: [
            {
              height: null,
              cells: [
                { text: '0,0', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
    },
    {
      label: 'vertical',
      selection: { kind: 'none' },
      portal: ['<div id="mount"></div>'],
      cursor: '',
      edge: null,
      tags: [],
      events: [
        'doc+pointermove:null',
        'doc+pointerup:null',
        'doc+pointercancel:null',
        'doc+touchmove:{"passive":false}',
        'doc+pointerup:null',
        'doc+pointercancel:null',
        'doc-touchmove:null',
        'doc-pointerup:null',
        'doc-pointercancel:null',
      ],
      defaultPrevented: false,
      model: [
        {
          type: 'table',
          colWidths: [120, 100],
          rows: [
            {
              height: null,
              cells: [
                { text: '0,0', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
    },
    {
      label: 'still-349',
      selection: { kind: 'none' },
      portal: ['<div id="mount"></div>'],
      cursor: '',
      edge: null,
      tags: [],
      events: [
        'doc-pointermove:null',
        'doc-pointerup:null',
        'doc-pointercancel:null',
        'doc+pointermove:null',
        'doc+pointerup:null',
        'doc+pointercancel:null',
        'doc+touchmove:{"passive":false}',
        'doc+pointerup:null',
        'doc+pointercancel:null',
      ],
      model: [
        {
          type: 'table',
          colWidths: [120, 100],
          rows: [
            {
              height: null,
              cells: [
                { text: '0,0', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
    },
    {
      label: 'still-350',
      selection: { kind: 'none' },
      portal: ['<div id="mount"></div>'],
      cursor: '',
      edge: null,
      tags: [],
      events: [
        'doc-touchmove:null',
        'doc-pointerup:null',
        'doc-pointercancel:null',
      ],
      defaultPrevented: false,
      model: [
        {
          type: 'table',
          colWidths: [120, 100],
          rows: [
            {
              height: null,
              cells: [
                { text: '0,0', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
    },
    {
      label: 'away',
      selection: { kind: 'none' },
      portal: ['<div id="mount"></div>'],
      cursor: '',
      edge: null,
      tags: [],
      events: [
        'doc-pointermove:null',
        'doc-pointerup:null',
        'doc-pointercancel:null',
        'doc+pointermove:null',
        'doc+pointerup:null',
        'doc+pointercancel:null',
      ],
      defaultPrevented: false,
      model: [
        {
          type: 'table',
          colWidths: [120, 100],
          rows: [
            {
              height: null,
              cells: [
                { text: '0,0', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
    },
    {
      label: 'non-primary',
      selection: { kind: 'none' },
      portal: ['<div id="mount"></div>'],
      cursor: '',
      edge: null,
      tags: [],
      events: [],
      model: [
        {
          type: 'table',
          colWidths: [120, 100],
          rows: [
            {
              height: null,
              cells: [
                { text: '0,0', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
    },
    {
      label: 'read-only',
      selection: { kind: 'none' },
      portal: ['<div id="mount"></div>'],
      cursor: '',
      edge: null,
      tags: [],
      events: [
        'doc-pointermove:null',
        'doc-pointerup:null',
        'doc-pointercancel:null',
        'doc+pointermove:null',
        'doc+pointerup:null',
        'doc+pointercancel:null',
      ],
      model: [
        {
          type: 'table',
          colWidths: [120, 100],
          rows: [
            {
              height: null,
              cells: [
                { text: '0,0', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
    },
  ]);
});
