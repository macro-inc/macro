/** @vitest-environment jsdom */
import { writeFileSync } from 'node:fs';
import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import {
  $createTableSelection,
  $getTableCellNodeFromLexicalNode,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  $isTableSelection,
} from '@lexical/table';
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  BLUR_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  FOCUS_COMMAND,
  type LexicalEditor,
  type NodeKey,
  SELECTION_CHANGE_COMMAND,
} from 'lexical';
import { render } from 'solid-js/web';
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  type LexicalWrapper,
  LexicalWrapperContext,
} from '../../context/LexicalWrapperContext';
import { createPluginManager } from '../../plugins';
import {
  $getCell,
  $getTable,
  buildTable,
  coordGrid,
  createTableTestEditor,
} from '../../plugins/tables/tableTestUtils';
import { TableMoveHandle } from './TableMoveHandle';

const touchDevice = vi.hoisted(() => vi.fn(() => false));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: touchDevice }));
vi.mock('@floating-ui/dom', async (original) => ({
  ...(await original<typeof import('@floating-ui/dom')>()),
  autoUpdate: (_reference: unknown, _floating: unknown, update: () => void) => {
    update();
    return () => {};
  },
  computePosition: async () => ({
    x: 7,
    y: 9,
    placement: 'bottom-end',
    strategy: 'absolute',
    middlewareData: {},
  }),
}));

/** jsdom has no PointerEvent; the init fields the handle reads are enough. */
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
const record: Record<string, unknown[]> = {};
const cleanups: Array<() => void> = [];
let events: string[] = [];

beforeEach(() => {
  touchDevice.mockReturnValue(false);
  events = [];
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
  // Lexical scrolls a collapsed caret into view through a Range rect.
  if (!('getBoundingClientRect' in Range.prototype))
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(0, 0, 0, 0),
    });
  vi.spyOn(HTMLElement.prototype, 'setPointerCapture').mockImplementation(
    function (this: HTMLElement, id) {
      events.push(`capture:${id}:${this.getAttribute('aria-label')}`);
    }
  );
  vi.spyOn(HTMLElement.prototype, 'releasePointerCapture').mockImplementation(
    (id) => {
      events.push(`release:${id}`);
    }
  );
  const rect = (element: Element) => {
    const rows = [...document.querySelectorAll('tr')];
    if (element instanceof HTMLTableCellElement) {
      const row = element.parentElement;
      const column = row ? [...row.children].indexOf(element) : 0;
      const rowIndex =
        row instanceof HTMLTableRowElement ? rows.indexOf(row) : 0;
      return new DOMRect(
        column * CELL_WIDTH,
        50 + rowIndex * CELL_HEIGHT,
        CELL_WIDTH,
        CELL_HEIGHT
      );
    }
    if (element instanceof HTMLTableElement)
      return new DOMRect(0, 50, 300, rows.length * CELL_HEIGHT);
    return undefined;
  };
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      return rect(this) ?? original.call(this);
    }
  );
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    writable: true,
    value: (x: number, y: number) => {
      const cells = [...document.querySelectorAll('td,th')];
      return (
        cells.find((cell) => {
          const box = rect(cell);
          return (
            box &&
            x >= box.left &&
            x < box.right &&
            y >= box.top &&
            y < box.bottom
          );
        }) ?? document.body
      );
    },
  });
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  document.body.innerHTML = '';
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

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const pointer = (type: string, init: PointerEventInit) =>
  new PointerEvent(type, { bubbles: true, cancelable: true, ...init });

type Coordinate = [row: number, column: number];

async function mount(
  build: (editor: LexicalEditor) => Promise<void> = (editor) =>
    buildTable(editor, coordGrid(3, 3))
) {
  const editor = createTableTestEditor();
  cleanups.push(registerHistory(editor, createEmptyHistoryState(), 0));
  await build(editor);
  await new Promise<void>((resolve) =>
    editor.update(
      () =>
        $getRoot().append(
          $createParagraphNode().append($createTextNode('after'))
        ),
      { onUpdate: () => resolve() }
    )
  );
  const tags: string[][] = [];
  cleanups.push(
    editor.registerUpdateListener(({ tags: updateTags, dirtyElements }) => {
      if (dirtyElements.size > 0) tags.push([...updateTags].sort());
    }),
    editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        events.push('selection-change');
        return false;
      },
      COMMAND_PRIORITY_CRITICAL
    )
  );
  const root = editor.getRootElement();
  if (!root) throw new Error('Missing root');
  root.tabIndex = 0;
  root.focus();
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
          <TableMoveHandle />
        </LexicalWrapperContext.Provider>
      ),
      container
    )
  );
  await settle();
  return { editor, tags };
}

function coordinate(key: NodeKey): Coordinate | string {
  const node = $getNodeByKey(key);
  const cell = node ? $getTableCellNodeFromLexicalNode(node) : null;
  if (!cell) return node?.getType() ?? 'missing';
  const row = cell.getParent();
  const table = row?.getParent();
  if (!row || !table) return 'detached';
  return [table.getChildren().indexOf(row), row.getChildren().indexOf(cell)];
}

async function select(
  editor: LexicalEditor,
  anchor: Coordinate,
  focus?: Coordinate
) {
  await new Promise<void>((resolve) =>
    editor.update(
      () => {
        if (!focus) {
          $getCell(...anchor).selectStart();
          return;
        }
        const selection = $createTableSelection();
        selection.set(
          $getTable().getKey(),
          $getCell(...anchor).getKey(),
          $getCell(...focus).getKey()
        );
        $setSelection(selection);
      },
      { onUpdate: () => resolve() }
    )
  );
  editor.dispatchCommand(SELECTION_CHANGE_COMMAND, undefined);
  await settle();
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
        anchor: coordinate(current.anchor.key),
        focus: coordinate(current.focus.key),
      };
    if ($isRangeSelection(current))
      return {
        kind: 'range',
        anchor: coordinate(current.anchor.key),
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
    tags: tags.splice(0),
    events: events.splice(0),
    ...extra,
  };
  entries.push({ ...entry, model: editor.getEditorState().toJSON() });
  const checks = checked[name] ?? [];
  checked[name] = checks;
  checks.push({ ...entry, model: editor.getEditorState().read($digest) });
}

function handle() {
  const button = document.querySelector('button[aria-label="Move cells"]');
  if (!(button instanceof HTMLButtonElement)) throw new Error('Missing handle');
  return button;
}

function button(label: string) {
  const found = document.querySelector(`button[aria-label="${label}"]`);
  if (!(found instanceof HTMLButtonElement))
    throw new Error(`Missing ${label}`);
  return found;
}

test('caret handle drags onto a cell; under-threshold moves do nothing', async () => {
  const { editor, tags } = await mount();
  snapshot('drag', 'mounted', editor, tags);
  await select(editor, [0, 0]);
  snapshot('drag', 'caret-tracked', editor, tags);
  const down = pointer('pointerdown', { clientX: 97, clientY: 50 });
  handle().dispatchEvent(down);
  snapshot('drag', 'down', editor, tags, {
    defaultPrevented: down.defaultPrevented,
  });
  handle().dispatchEvent(pointer('pointermove', { clientX: 99, clientY: 52 }));
  snapshot('drag', 'under-threshold', editor, tags);
  handle().dispatchEvent(pointer('pointermove', { clientX: 150, clientY: 95 }));
  snapshot('drag', 'over-cell-1-1', editor, tags);
  handle().dispatchEvent(
    pointer('pointermove', { clientX: 150, clientY: 400 })
  );
  snapshot('drag', 'off-table', editor, tags);
  handle().dispatchEvent(
    pointer('pointermove', { clientX: 250, clientY: 125 })
  );
  snapshot('drag', 'over-cell-2-2', editor, tags);
  handle().dispatchEvent(pointer('pointerup', { clientX: 250, clientY: 125 }));
  await settle();
  snapshot('drag', 'dropped', editor, tags);
  expect(checked['drag']).toEqual([
    {
      label: 'mounted',
      selection: { kind: 'none' },
      portal: ['<div id="mount"></div>'],
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
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
                { text: '1,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '2,0', colSpan: 1, rowSpan: 1 },
                { text: '2,1', colSpan: 1, rowSpan: 1 },
                { text: '2,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
    {
      label: 'caret-tracked',
      selection: { kind: 'range', anchor: [0, 0], offset: 0 },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div data-layer="" style="display:contents" data-depth="2"><button type="button" aria-label="Move cells" class="fixed z-20 flex size-6 -translate-x-[calc(100%-3px)] -translate-y-[3px] items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm touch-none cursor-grab" style="left: 100px; top: 50px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="dots-six-vertical" viewBox="0 0 24 24" class="size-3.5"><g fill="currentColor" stroke="none"><circle cx="8.5" cy="5" r="1.35"></circle><circle cx="15.5" cy="5" r="1.35"></circle><circle cx="8.5" cy="12" r="1.35"></circle><circle cx="15.5" cy="12" r="1.35"></circle><circle cx="8.5" cy="19" r="1.35"></circle><circle cx="15.5" cy="19" r="1.35"></circle></g></svg></button></div></div>',
      ],
      tags: [],
      events: ['selection-change'],
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
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
                { text: '1,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '2,0', colSpan: 1, rowSpan: 1 },
                { text: '2,1', colSpan: 1, rowSpan: 1 },
                { text: '2,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
    {
      label: 'down',
      selection: { kind: 'range', anchor: [0, 0], offset: 0 },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div data-layer="" style="display:contents" data-depth="2"><button type="button" aria-label="Move cells" class="fixed z-20 flex size-6 -translate-x-[calc(100%-3px)] -translate-y-[3px] items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm touch-none cursor-grab" style="left: 100px; top: 50px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="dots-six-vertical" viewBox="0 0 24 24" class="size-3.5"><g fill="currentColor" stroke="none"><circle cx="8.5" cy="5" r="1.35"></circle><circle cx="15.5" cy="5" r="1.35"></circle><circle cx="8.5" cy="12" r="1.35"></circle><circle cx="15.5" cy="12" r="1.35"></circle><circle cx="8.5" cy="19" r="1.35"></circle><circle cx="15.5" cy="19" r="1.35"></circle></g></svg></button></div></div>',
      ],
      tags: [],
      events: ['capture:1:Move cells'],
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
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
                { text: '1,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '2,0', colSpan: 1, rowSpan: 1 },
                { text: '2,1', colSpan: 1, rowSpan: 1 },
                { text: '2,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
    {
      label: 'under-threshold',
      selection: { kind: 'range', anchor: [0, 0], offset: 0 },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div data-layer="" style="display:contents" data-depth="2"><button type="button" aria-label="Move cells" class="fixed z-20 flex size-6 -translate-x-[calc(100%-3px)] -translate-y-[3px] items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm touch-none cursor-grab" style="left: 100px; top: 50px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="dots-six-vertical" viewBox="0 0 24 24" class="size-3.5"><g fill="currentColor" stroke="none"><circle cx="8.5" cy="5" r="1.35"></circle><circle cx="15.5" cy="5" r="1.35"></circle><circle cx="8.5" cy="12" r="1.35"></circle><circle cx="15.5" cy="12" r="1.35"></circle><circle cx="8.5" cy="19" r="1.35"></circle><circle cx="15.5" cy="19" r="1.35"></circle></g></svg></button></div></div>',
      ],
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
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
                { text: '1,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '2,0', colSpan: 1, rowSpan: 1 },
                { text: '2,1', colSpan: 1, rowSpan: 1 },
                { text: '2,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
    {
      label: 'over-cell-1-1',
      selection: { kind: 'range', anchor: [0, 0], offset: 0 },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div data-layer="" style="display:contents" data-depth="2"><div class="fixed z-10 pointer-events-none bg-accent/15 ring-1 ring-accent/60" style="left: 100px; top: 80px; width: 100px; height: 30px;"></div><button type="button" aria-label="Move cells" class="fixed z-20 flex size-6 -translate-x-[calc(100%-3px)] -translate-y-[3px] items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm touch-none cursor-grabbing" style="left: 100px; top: 50px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="dots-six-vertical" viewBox="0 0 24 24" class="size-3.5"><g fill="currentColor" stroke="none"><circle cx="8.5" cy="5" r="1.35"></circle><circle cx="15.5" cy="5" r="1.35"></circle><circle cx="8.5" cy="12" r="1.35"></circle><circle cx="15.5" cy="12" r="1.35"></circle><circle cx="8.5" cy="19" r="1.35"></circle><circle cx="15.5" cy="19" r="1.35"></circle></g></svg></button></div></div>',
      ],
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
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
                { text: '1,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '2,0', colSpan: 1, rowSpan: 1 },
                { text: '2,1', colSpan: 1, rowSpan: 1 },
                { text: '2,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
    {
      label: 'off-table',
      selection: { kind: 'range', anchor: [0, 0], offset: 0 },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div data-layer="" style="display:contents" data-depth="2"><button type="button" aria-label="Move cells" class="fixed z-20 flex size-6 -translate-x-[calc(100%-3px)] -translate-y-[3px] items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm touch-none cursor-grabbing" style="left: 100px; top: 50px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="dots-six-vertical" viewBox="0 0 24 24" class="size-3.5"><g fill="currentColor" stroke="none"><circle cx="8.5" cy="5" r="1.35"></circle><circle cx="15.5" cy="5" r="1.35"></circle><circle cx="8.5" cy="12" r="1.35"></circle><circle cx="15.5" cy="12" r="1.35"></circle><circle cx="8.5" cy="19" r="1.35"></circle><circle cx="15.5" cy="19" r="1.35"></circle></g></svg></button></div></div>',
      ],
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
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
                { text: '1,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '2,0', colSpan: 1, rowSpan: 1 },
                { text: '2,1', colSpan: 1, rowSpan: 1 },
                { text: '2,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
    {
      label: 'over-cell-2-2',
      selection: { kind: 'range', anchor: [0, 0], offset: 0 },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div data-layer="" style="display:contents" data-depth="2"><div class="fixed z-10 pointer-events-none bg-accent/15 ring-1 ring-accent/60" style="left: 200px; top: 110px; width: 100px; height: 30px;"></div><button type="button" aria-label="Move cells" class="fixed z-20 flex size-6 -translate-x-[calc(100%-3px)] -translate-y-[3px] items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm touch-none cursor-grabbing" style="left: 100px; top: 50px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="dots-six-vertical" viewBox="0 0 24 24" class="size-3.5"><g fill="currentColor" stroke="none"><circle cx="8.5" cy="5" r="1.35"></circle><circle cx="15.5" cy="5" r="1.35"></circle><circle cx="8.5" cy="12" r="1.35"></circle><circle cx="15.5" cy="12" r="1.35"></circle><circle cx="8.5" cy="19" r="1.35"></circle><circle cx="15.5" cy="19" r="1.35"></circle></g></svg></button></div></div>',
      ],
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
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
                { text: '1,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '2,0', colSpan: 1, rowSpan: 1 },
                { text: '2,1', colSpan: 1, rowSpan: 1 },
                { text: '2,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
    {
      label: 'dropped',
      selection: { kind: 'range', anchor: [2, 2], offset: 0 },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div data-layer="" style="display:contents" data-depth="2"><button type="button" aria-label="Move cells" class="fixed z-20 flex size-6 -translate-x-[calc(100%-3px)] -translate-y-[3px] items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm touch-none cursor-grab" style="left: 100px; top: 50px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="dots-six-vertical" viewBox="0 0 24 24" class="size-3.5"><g fill="currentColor" stroke="none"><circle cx="8.5" cy="5" r="1.35"></circle><circle cx="15.5" cy="5" r="1.35"></circle><circle cx="8.5" cy="12" r="1.35"></circle><circle cx="15.5" cy="12" r="1.35"></circle><circle cx="8.5" cy="19" r="1.35"></circle><circle cx="15.5" cy="19" r="1.35"></circle></g></svg></button></div></div>',
      ],
      tags: [[]],
      events: ['release:1'],
      model: [
        {
          type: 'table',
          colWidths: null,
          rows: [
            {
              height: null,
              cells: [
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
                { text: '1,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '2,0', colSpan: 1, rowSpan: 1 },
                { text: '2,1', colSpan: 1, rowSpan: 1 },
                { text: '0,0', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
  ]);
});

test('table selection drag previews its footprint and appended rows; Escape aborts', async () => {
  const { editor, tags } = await mount();
  await select(editor, [0, 0], [1, 1]);
  snapshot('range-drag', 'tracked', editor, tags);
  handle().dispatchEvent(pointer('pointerdown', { clientX: 197, clientY: 50 }));
  handle().dispatchEvent(
    pointer('pointermove', { clientX: 250, clientY: 125 })
  );
  snapshot('range-drag', 'over-cell-2-2', editor, tags);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await settle();
  snapshot('range-drag', 'escape', editor, tags);
  handle().dispatchEvent(pointer('pointerup', { clientX: 250, clientY: 125 }));
  await settle();
  snapshot('range-drag', 'stale-up-ignored', editor, tags);
  handle().dispatchEvent(pointer('pointerdown', { clientX: 197, clientY: 50 }));
  handle().dispatchEvent(pointer('pointermove', { clientX: 150, clientY: 95 }));
  snapshot('range-drag', 'over-cell-1-1', editor, tags);
  handle().dispatchEvent(pointer('pointerup', { clientX: 150, clientY: 95 }));
  await settle();
  snapshot('range-drag', 'dropped', editor, tags);
  handle().dispatchEvent(pointer('pointerdown', { clientX: 197, clientY: 80 }));
  handle().dispatchEvent(
    pointer('pointermove', { clientX: 150, clientY: 400 })
  );
  handle().dispatchEvent(pointer('pointercancel', {}));
  await settle();
  snapshot('range-drag', 'cancel', editor, tags);
  expect(checked['range-drag']).toEqual([
    {
      label: 'tracked',
      selection: { kind: 'table', anchor: [0, 0], focus: [1, 1] },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div data-layer="" style="display:contents" data-depth="2"><button type="button" aria-label="Move cells" class="fixed z-20 flex size-6 -translate-x-[calc(100%-3px)] -translate-y-[3px] items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm touch-none cursor-grab" style="left: 200px; top: 50px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="dots-six-vertical" viewBox="0 0 24 24" class="size-3.5"><g fill="currentColor" stroke="none"><circle cx="8.5" cy="5" r="1.35"></circle><circle cx="15.5" cy="5" r="1.35"></circle><circle cx="8.5" cy="12" r="1.35"></circle><circle cx="15.5" cy="12" r="1.35"></circle><circle cx="8.5" cy="19" r="1.35"></circle><circle cx="15.5" cy="19" r="1.35"></circle></g></svg></button></div></div>',
      ],
      tags: [],
      events: ['selection-change', 'selection-change'],
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
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
                { text: '1,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '2,0', colSpan: 1, rowSpan: 1 },
                { text: '2,1', colSpan: 1, rowSpan: 1 },
                { text: '2,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
    {
      label: 'over-cell-2-2',
      selection: { kind: 'table', anchor: [0, 0], focus: [1, 1] },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div data-layer="" style="display:contents" data-depth="2"><div class="fixed z-10 pointer-events-none bg-accent/15 ring-1 ring-accent/60" style="left: 200px; top: 110px; width: 100px; height: 60px;"></div><button type="button" aria-label="Move cells" class="fixed z-20 flex size-6 -translate-x-[calc(100%-3px)] -translate-y-[3px] items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm touch-none cursor-grabbing" style="left: 200px; top: 50px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="dots-six-vertical" viewBox="0 0 24 24" class="size-3.5"><g fill="currentColor" stroke="none"><circle cx="8.5" cy="5" r="1.35"></circle><circle cx="15.5" cy="5" r="1.35"></circle><circle cx="8.5" cy="12" r="1.35"></circle><circle cx="15.5" cy="12" r="1.35"></circle><circle cx="8.5" cy="19" r="1.35"></circle><circle cx="15.5" cy="19" r="1.35"></circle></g></svg></button></div></div>',
      ],
      tags: [],
      events: ['capture:1:Move cells'],
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
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
                { text: '1,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '2,0', colSpan: 1, rowSpan: 1 },
                { text: '2,1', colSpan: 1, rowSpan: 1 },
                { text: '2,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
    {
      label: 'escape',
      selection: { kind: 'table', anchor: [0, 0], focus: [1, 1] },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div data-layer="" style="display:contents" data-depth="2"><button type="button" aria-label="Move cells" class="fixed z-20 flex size-6 -translate-x-[calc(100%-3px)] -translate-y-[3px] items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm touch-none cursor-grab" style="left: 200px; top: 50px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="dots-six-vertical" viewBox="0 0 24 24" class="size-3.5"><g fill="currentColor" stroke="none"><circle cx="8.5" cy="5" r="1.35"></circle><circle cx="15.5" cy="5" r="1.35"></circle><circle cx="8.5" cy="12" r="1.35"></circle><circle cx="15.5" cy="12" r="1.35"></circle><circle cx="8.5" cy="19" r="1.35"></circle><circle cx="15.5" cy="19" r="1.35"></circle></g></svg></button></div></div>',
      ],
      tags: [],
      events: ['release:1'],
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
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
                { text: '1,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '2,0', colSpan: 1, rowSpan: 1 },
                { text: '2,1', colSpan: 1, rowSpan: 1 },
                { text: '2,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
    {
      label: 'stale-up-ignored',
      selection: { kind: 'table', anchor: [0, 0], focus: [1, 1] },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div data-layer="" style="display:contents" data-depth="2"><button type="button" aria-label="Move cells" class="fixed z-20 flex size-6 -translate-x-[calc(100%-3px)] -translate-y-[3px] items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm touch-none cursor-grab" style="left: 200px; top: 50px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="dots-six-vertical" viewBox="0 0 24 24" class="size-3.5"><g fill="currentColor" stroke="none"><circle cx="8.5" cy="5" r="1.35"></circle><circle cx="15.5" cy="5" r="1.35"></circle><circle cx="8.5" cy="12" r="1.35"></circle><circle cx="15.5" cy="12" r="1.35"></circle><circle cx="8.5" cy="19" r="1.35"></circle><circle cx="15.5" cy="19" r="1.35"></circle></g></svg></button></div></div>',
      ],
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
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
                { text: '1,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '2,0', colSpan: 1, rowSpan: 1 },
                { text: '2,1', colSpan: 1, rowSpan: 1 },
                { text: '2,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
    {
      label: 'over-cell-1-1',
      selection: { kind: 'table', anchor: [0, 0], focus: [1, 1] },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div data-layer="" style="display:contents" data-depth="2"><div class="fixed z-10 pointer-events-none bg-accent/15 ring-1 ring-accent/60" style="left: 100px; top: 80px; width: 200px; height: 60px;"></div><button type="button" aria-label="Move cells" class="fixed z-20 flex size-6 -translate-x-[calc(100%-3px)] -translate-y-[3px] items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm touch-none cursor-grabbing" style="left: 200px; top: 50px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="dots-six-vertical" viewBox="0 0 24 24" class="size-3.5"><g fill="currentColor" stroke="none"><circle cx="8.5" cy="5" r="1.35"></circle><circle cx="15.5" cy="5" r="1.35"></circle><circle cx="8.5" cy="12" r="1.35"></circle><circle cx="15.5" cy="12" r="1.35"></circle><circle cx="8.5" cy="19" r="1.35"></circle><circle cx="15.5" cy="19" r="1.35"></circle></g></svg></button></div></div>',
      ],
      tags: [],
      events: ['capture:1:Move cells'],
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
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
                { text: '1,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '2,0', colSpan: 1, rowSpan: 1 },
                { text: '2,1', colSpan: 1, rowSpan: 1 },
                { text: '2,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
    {
      label: 'dropped',
      selection: { kind: 'table', anchor: [0, 0], focus: [1, 1] },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div data-layer="" style="display:contents" data-depth="2"><button type="button" aria-label="Move cells" class="fixed z-20 flex size-6 -translate-x-[calc(100%-3px)] -translate-y-[3px] items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm touch-none cursor-grab" style="left: 200px; top: 50px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="dots-six-vertical" viewBox="0 0 24 24" class="size-3.5"><g fill="currentColor" stroke="none"><circle cx="8.5" cy="5" r="1.35"></circle><circle cx="15.5" cy="5" r="1.35"></circle><circle cx="8.5" cy="12" r="1.35"></circle><circle cx="15.5" cy="12" r="1.35"></circle><circle cx="8.5" cy="19" r="1.35"></circle><circle cx="15.5" cy="19" r="1.35"></circle></g></svg></button></div></div>',
      ],
      tags: [],
      events: ['release:1'],
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
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
                { text: '1,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '2,0', colSpan: 1, rowSpan: 1 },
                { text: '2,1', colSpan: 1, rowSpan: 1 },
                { text: '2,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
    {
      label: 'cancel',
      selection: { kind: 'table', anchor: [0, 0], focus: [1, 1] },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div data-layer="" style="display:contents" data-depth="2"><button type="button" aria-label="Move cells" class="fixed z-20 flex size-6 -translate-x-[calc(100%-3px)] -translate-y-[3px] items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm touch-none cursor-grab" style="left: 200px; top: 50px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="dots-six-vertical" viewBox="0 0 24 24" class="size-3.5"><g fill="currentColor" stroke="none"><circle cx="8.5" cy="5" r="1.35"></circle><circle cx="15.5" cy="5" r="1.35"></circle><circle cx="8.5" cy="12" r="1.35"></circle><circle cx="15.5" cy="12" r="1.35"></circle><circle cx="8.5" cy="19" r="1.35"></circle><circle cx="15.5" cy="19" r="1.35"></circle></g></svg></button></div></div>',
      ],
      tags: [],
      events: ['capture:1:Move cells', 'release:1'],
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
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
                { text: '1,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '2,0', colSpan: 1, rowSpan: 1 },
                { text: '2,1', colSpan: 1, rowSpan: 1 },
                { text: '2,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
  ]);
});

test('desktop tap selects the handle cells and fires SELECTION_CHANGE', async () => {
  const { editor, tags } = await mount();
  await select(editor, [1, 2]);
  handle().dispatchEvent(pointer('pointerdown', { clientX: 297, clientY: 80 }));
  handle().dispatchEvent(pointer('pointerup', { clientX: 297, clientY: 80 }));
  await settle();
  snapshot('tap', 'tapped', editor, tags);
  await select(editor, [0, 1], [2, 0]);
  handle().dispatchEvent(pointer('pointerdown', { clientX: 197, clientY: 50 }));
  handle().dispatchEvent(pointer('pointerup', { clientX: 197, clientY: 50 }));
  await settle();
  snapshot('tap', 'tapped-range', editor, tags);
  expect(checked['tap']).toEqual([
    {
      label: 'tapped',
      selection: { kind: 'table', anchor: [1, 2], focus: [1, 2] },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div data-layer="" style="display:contents" data-depth="2"><button type="button" aria-label="Move cells" class="fixed z-20 flex size-6 -translate-x-[calc(100%-3px)] -translate-y-[3px] items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm touch-none cursor-grab" style="left: 300px; top: 80px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="dots-six-vertical" viewBox="0 0 24 24" class="size-3.5"><g fill="currentColor" stroke="none"><circle cx="8.5" cy="5" r="1.35"></circle><circle cx="15.5" cy="5" r="1.35"></circle><circle cx="8.5" cy="12" r="1.35"></circle><circle cx="15.5" cy="12" r="1.35"></circle><circle cx="8.5" cy="19" r="1.35"></circle><circle cx="15.5" cy="19" r="1.35"></circle></g></svg></button></div></div>',
      ],
      tags: [],
      events: [
        'selection-change',
        'capture:1:Move cells',
        'selection-change',
        'release:1',
        'selection-change',
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
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
                { text: '1,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '2,0', colSpan: 1, rowSpan: 1 },
                { text: '2,1', colSpan: 1, rowSpan: 1 },
                { text: '2,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
    {
      label: 'tapped-range',
      selection: { kind: 'table', anchor: [0, 1], focus: [2, 0] },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div data-layer="" style="display:contents" data-depth="2"><button type="button" aria-label="Move cells" class="fixed z-20 flex size-6 -translate-x-[calc(100%-3px)] -translate-y-[3px] items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm touch-none cursor-grab" style="left: 200px; top: 50px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="dots-six-vertical" viewBox="0 0 24 24" class="size-3.5"><g fill="currentColor" stroke="none"><circle cx="8.5" cy="5" r="1.35"></circle><circle cx="15.5" cy="5" r="1.35"></circle><circle cx="8.5" cy="12" r="1.35"></circle><circle cx="15.5" cy="12" r="1.35"></circle><circle cx="8.5" cy="19" r="1.35"></circle><circle cx="15.5" cy="19" r="1.35"></circle></g></svg></button></div></div>',
      ],
      tags: [],
      events: [
        'selection-change',
        'selection-change',
        'capture:1:Move cells',
        'selection-change',
        'release:1',
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
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
                { text: '1,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '2,0', colSpan: 1, rowSpan: 1 },
                { text: '2,1', colSpan: 1, rowSpan: 1 },
                { text: '2,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
  ]);
});

test('focus gating: blur hides, focus shows, selection outside clears', async () => {
  const { editor, tags } = await mount();
  await select(editor, [0, 0]);
  editor.dispatchCommand(BLUR_COMMAND, new FocusEvent('blur'));
  snapshot('focus', 'blurred', editor, tags);
  editor.dispatchCommand(FOCUS_COMMAND, new FocusEvent('focus'));
  snapshot('focus', 'focused', editor, tags);
  await new Promise<void>((resolve) =>
    editor.update(() => $getRoot().getLastChildOrThrow().selectEnd(), {
      onUpdate: () => resolve(),
    })
  );
  editor.dispatchCommand(SELECTION_CHANGE_COMMAND, undefined);
  await settle();
  snapshot('focus', 'outside', editor, tags);
  expect(checked['focus']).toEqual([
    {
      label: 'blurred',
      selection: { kind: 'range', anchor: [0, 0], offset: 0 },
      portal: ['<div id="mount"></div>'],
      tags: [],
      events: ['selection-change'],
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
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
                { text: '1,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '2,0', colSpan: 1, rowSpan: 1 },
                { text: '2,1', colSpan: 1, rowSpan: 1 },
                { text: '2,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
    {
      label: 'focused',
      selection: { kind: 'range', anchor: [0, 0], offset: 0 },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div data-layer="" style="display:contents" data-depth="2"><button type="button" aria-label="Move cells" class="fixed z-20 flex size-6 -translate-x-[calc(100%-3px)] -translate-y-[3px] items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm touch-none cursor-grab" style="left: 100px; top: 50px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="dots-six-vertical" viewBox="0 0 24 24" class="size-3.5"><g fill="currentColor" stroke="none"><circle cx="8.5" cy="5" r="1.35"></circle><circle cx="15.5" cy="5" r="1.35"></circle><circle cx="8.5" cy="12" r="1.35"></circle><circle cx="15.5" cy="12" r="1.35"></circle><circle cx="8.5" cy="19" r="1.35"></circle><circle cx="15.5" cy="19" r="1.35"></circle></g></svg></button></div></div>',
      ],
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
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
                { text: '1,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '2,0', colSpan: 1, rowSpan: 1 },
                { text: '2,1', colSpan: 1, rowSpan: 1 },
                { text: '2,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
    {
      label: 'outside',
      selection: { kind: 'range', anchor: 'text', offset: 5 },
      portal: ['<div id="mount"></div>'],
      tags: [],
      events: ['selection-change'],
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
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
                { text: '1,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '2,0', colSpan: 1, rowSpan: 1 },
                { text: '2,1', colSpan: 1, rowSpan: 1 },
                { text: '2,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
  ]);
});

test('touch: tap opens the menu; items act on the live selection', async () => {
  touchDevice.mockReturnValue(true);
  const { editor, tags } = await mount();
  await select(editor, [0, 0], [1, 0]);
  snapshot('touch-menu', 'tracked', editor, tags);
  handle().dispatchEvent(
    pointer('pointerdown', {
      ...{ pointerType: 'touch' },
      clientX: 97,
      clientY: 50,
    })
  );
  handle().dispatchEvent(
    pointer('pointerup', { pointerType: 'touch', clientX: 97, clientY: 50 })
  );
  await settle();
  snapshot('touch-menu', 'menu-open', editor, tags);
  button('Insert row below').click();
  await settle();
  snapshot('touch-menu', 'insert-row-below', editor, tags);
  for (const label of [
    'Insert row above',
    'Insert column left',
    'Insert column right',
    'Delete column',
    'Delete row',
  ]) {
    await select(editor, [1, 1], [2, 1]);
    handle().dispatchEvent(
      pointer('pointerdown', {
        pointerType: 'touch',
        clientX: 197,
        clientY: 80,
      })
    );
    handle().dispatchEvent(
      pointer('pointerup', { pointerType: 'touch', clientX: 197, clientY: 80 })
    );
    await settle();
    button(label).click();
    await settle();
    snapshot('touch-menu', label, editor, tags);
  }
  expect(checked['touch-menu']).toEqual([
    {
      label: 'tracked',
      selection: { kind: 'table', anchor: [0, 0], focus: [1, 0] },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div data-layer="" style="display:contents" data-depth="2"><button type="button" aria-label="Move cells" class="fixed z-20 flex size-6 -translate-x-[calc(100%-3px)] -translate-y-[3px] items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm touch-none cursor-grab" style="left: 100px; top: 50px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="dots-six-vertical" viewBox="0 0 24 24" class="size-3.5"><g fill="currentColor" stroke="none"><circle cx="8.5" cy="5" r="1.35"></circle><circle cx="15.5" cy="5" r="1.35"></circle><circle cx="8.5" cy="12" r="1.35"></circle><circle cx="15.5" cy="12" r="1.35"></circle><circle cx="8.5" cy="19" r="1.35"></circle><circle cx="15.5" cy="19" r="1.35"></circle></g></svg></button><button type="button" aria-label="Delete table" title="Delete table" class="fixed z-20 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-edge bg-surface text-failure shadow-sm active:border-failure active:bg-failure active:text-surface" style="left: 0px; top: 50px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="trash-simple" viewBox="0 0 24 24" class="size-3.5"><path d="M4.5 6.75h15M9 6.75V4.5c0-.55.45-1 1-1h4c.55 0 1 .45 1 1v2.25m-8.75 0 .6 11.35c.07 1.34 1.17 2.4 2.51 2.4h5.28c1.34 0 2.44-1.06 2.51-2.4l.6-11.35"></path></svg></button></div></div>',
      ],
      tags: [],
      events: ['selection-change', 'selection-change'],
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
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
                { text: '1,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '2,0', colSpan: 1, rowSpan: 1 },
                { text: '2,1', colSpan: 1, rowSpan: 1 },
                { text: '2,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
    {
      label: 'menu-open',
      selection: { kind: 'table', anchor: [0, 0], focus: [1, 0] },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div data-layer="" style="display:contents" data-depth="2"><button type="button" aria-label="Move cells" class="fixed z-20 flex size-6 -translate-x-[calc(100%-3px)] -translate-y-[3px] items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm touch-none cursor-grab" style="left: 100px; top: 50px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="dots-six-vertical" viewBox="0 0 24 24" class="size-3.5"><g fill="currentColor" stroke="none"><circle cx="8.5" cy="5" r="1.35"></circle><circle cx="15.5" cy="5" r="1.35"></circle><circle cx="8.5" cy="12" r="1.35"></circle><circle cx="15.5" cy="12" r="1.35"></circle><circle cx="8.5" cy="19" r="1.35"></circle><circle cx="15.5" cy="19" r="1.35"></circle></g></svg></button><button type="button" aria-label="Delete table" title="Delete table" class="fixed z-20 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-edge bg-surface text-failure shadow-sm active:border-failure active:bg-failure active:text-surface" style="left: 0px; top: 50px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="trash-simple" viewBox="0 0 24 24" class="size-3.5"><path d="M4.5 6.75h15M9 6.75V4.5c0-.55.45-1 1-1h4c.55 0 1 .45 1 1v2.25m-8.75 0 .6 11.35c.07 1.34 1.17 2.4 2.51 2.4h5.28c1.34 0 2.44-1.06 2.51-2.4l.6-11.35"></path></svg></button><div class="menu-surface z-30 grid grid-cols-2 gap-1 overflow-y-auto p-1.5" style="width: 104px; max-height: 140px; position: absolute; visibility: visible; left: 7px; top: 9px;"><button type="button" class="flex items-center justify-center rounded-md py-2 ring-1 ring-edge active:bg-accent/10 text-ink-muted" aria-label="Insert column left" title="Insert column left"><span class="relative"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="columns-plus-left" viewBox="0 0 24 24" class="size-5"><rect width="11" height="18" x="10" y="3" rx="2"></rect><path d="M15.5 3v18M2 12h5M4.5 9.5v5"></path></svg></span></button><button type="button" class="flex items-center justify-center rounded-md py-2 ring-1 ring-edge active:bg-accent/10 text-ink-muted" aria-label="Insert column right" title="Insert column right"><span class="relative"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="columns-plus-right" viewBox="0 0 24 24" class="size-5"><rect width="7" height="18" x="3" y="3" rx="2"></rect><path d="M16 3h-1a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h1m2-12.5v7M14.5 12h7"></path></svg></span></button><button type="button" class="flex items-center justify-center rounded-md py-2 ring-1 ring-edge active:bg-accent/10 text-ink-muted" aria-label="Insert row below" title="Insert row below"><span class="relative"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="rows-plus-bottom" viewBox="0 0 24 24" class="size-5"><g transform="rotate(-90 12 12)"><rect width="11" height="18" x="10" y="3" rx="2"></rect><path d="M15.5 3v18M2 12h5M4.5 9.5v5"></path></g></svg></span></button><button type="button" class="flex items-center justify-center rounded-md py-2 ring-1 ring-edge active:bg-accent/10 text-ink-muted" aria-label="Insert row above" title="Insert row above"><span class="relative"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="rows-plus-top" viewBox="0 0 24 24" class="size-5"><g transform="rotate(90 12 12)"><rect width="11" height="18" x="10" y="3" rx="2"></rect><path d="M15.5 3v18M2 12h5M4.5 9.5v5"></path></g></svg></span></button><button type="button" class="flex items-center justify-center rounded-md py-2 ring-1 ring-edge active:bg-accent/10 text-failure" aria-label="Delete row" title="Delete row"><span class="relative"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="rows" viewBox="0 0 24 24" class="size-5"><rect width="18" height="6.5" x="3" y="4" rx="2"></rect><rect width="18" height="6.5" x="3" y="13.5" rx="2"></rect></svg><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="trash-simple" viewBox="0 0 24 24" class="absolute -right-1 -bottom-1 size-3 rounded-full bg-surface"><path d="M4.5 6.75h15M9 6.75V4.5c0-.55.45-1 1-1h4c.55 0 1 .45 1 1v2.25m-8.75 0 .6 11.35c.07 1.34 1.17 2.4 2.51 2.4h5.28c1.34 0 2.44-1.06 2.51-2.4l.6-11.35"></path></svg></span></button><button type="button" class="flex items-center justify-center rounded-md py-2 ring-1 ring-edge active:bg-accent/10 text-failure" aria-label="Delete column" title="Delete column"><span class="relative"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="columns" viewBox="0 0 24 24" class="size-5"><rect width="7" height="18" x="3.5" y="3" rx="2"></rect><rect width="7" height="18" x="13.5" y="3" rx="2"></rect></svg><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="trash-simple" viewBox="0 0 24 24" class="absolute -right-1 -bottom-1 size-3 rounded-full bg-surface"><path d="M4.5 6.75h15M9 6.75V4.5c0-.55.45-1 1-1h4c.55 0 1 .45 1 1v2.25m-8.75 0 .6 11.35c.07 1.34 1.17 2.4 2.51 2.4h5.28c1.34 0 2.44-1.06 2.51-2.4l.6-11.35"></path></svg></span></button></div></div></div>',
      ],
      tags: [],
      events: ['capture:1:Move cells', 'release:1'],
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
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
                { text: '1,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '2,0', colSpan: 1, rowSpan: 1 },
                { text: '2,1', colSpan: 1, rowSpan: 1 },
                { text: '2,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
    {
      label: 'insert-row-below',
      selection: { kind: 'table', anchor: [0, 0], focus: [1, 0] },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div data-layer="" style="display:contents" data-depth="2"><button type="button" aria-label="Move cells" class="fixed z-20 flex size-6 -translate-x-[calc(100%-3px)] -translate-y-[3px] items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm touch-none cursor-grab" style="left: 100px; top: 50px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="dots-six-vertical" viewBox="0 0 24 24" class="size-3.5"><g fill="currentColor" stroke="none"><circle cx="8.5" cy="5" r="1.35"></circle><circle cx="15.5" cy="5" r="1.35"></circle><circle cx="8.5" cy="12" r="1.35"></circle><circle cx="15.5" cy="12" r="1.35"></circle><circle cx="8.5" cy="19" r="1.35"></circle><circle cx="15.5" cy="19" r="1.35"></circle></g></svg></button><button type="button" aria-label="Delete table" title="Delete table" class="fixed z-20 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-edge bg-surface text-failure shadow-sm active:border-failure active:bg-failure active:text-surface" style="left: 0px; top: 50px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="trash-simple" viewBox="0 0 24 24" class="size-3.5"><path d="M4.5 6.75h15M9 6.75V4.5c0-.55.45-1 1-1h4c.55 0 1 .45 1 1v2.25m-8.75 0 .6 11.35c.07 1.34 1.17 2.4 2.51 2.4h5.28c1.34 0 2.44-1.06 2.51-2.4l.6-11.35"></path></svg></button></div></div>',
      ],
      tags: [[]],
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
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
                { text: '1,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '2,0', colSpan: 1, rowSpan: 1 },
                { text: '2,1', colSpan: 1, rowSpan: 1 },
                { text: '2,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
    {
      label: 'Insert row above',
      selection: { kind: 'table', anchor: [2, 1], focus: [3, 1] },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div data-layer="" style="display:contents" data-depth="2"><button type="button" aria-label="Move cells" class="fixed z-20 flex size-6 -translate-x-[calc(100%-3px)] -translate-y-[3px] items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm touch-none cursor-grab" style="left: 200px; top: 110px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="dots-six-vertical" viewBox="0 0 24 24" class="size-3.5"><g fill="currentColor" stroke="none"><circle cx="8.5" cy="5" r="1.35"></circle><circle cx="15.5" cy="5" r="1.35"></circle><circle cx="8.5" cy="12" r="1.35"></circle><circle cx="15.5" cy="12" r="1.35"></circle><circle cx="8.5" cy="19" r="1.35"></circle><circle cx="15.5" cy="19" r="1.35"></circle></g></svg></button><button type="button" aria-label="Delete table" title="Delete table" class="fixed z-20 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-edge bg-surface text-failure shadow-sm active:border-failure active:bg-failure active:text-surface" style="left: 0px; top: 50px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="trash-simple" viewBox="0 0 24 24" class="size-3.5"><path d="M4.5 6.75h15M9 6.75V4.5c0-.55.45-1 1-1h4c.55 0 1 .45 1 1v2.25m-8.75 0 .6 11.35c.07 1.34 1.17 2.4 2.51 2.4h5.28c1.34 0 2.44-1.06 2.51-2.4l.6-11.35"></path></svg></button></div></div>',
      ],
      tags: [[]],
      events: [
        'selection-change',
        'selection-change',
        'capture:1:Move cells',
        'release:1',
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
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
                { text: '1,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '2,0', colSpan: 1, rowSpan: 1 },
                { text: '2,1', colSpan: 1, rowSpan: 1 },
                { text: '2,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
    {
      label: 'Insert column left',
      selection: { kind: 'range', anchor: [0, 1], offset: 0 },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div data-layer="" style="display:contents" data-depth="2"><button type="button" aria-label="Move cells" class="fixed z-20 flex size-6 -translate-x-[calc(100%-3px)] -translate-y-[3px] items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm touch-none cursor-grab" style="left: 300px; top: 80px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="dots-six-vertical" viewBox="0 0 24 24" class="size-3.5"><g fill="currentColor" stroke="none"><circle cx="8.5" cy="5" r="1.35"></circle><circle cx="15.5" cy="5" r="1.35"></circle><circle cx="8.5" cy="12" r="1.35"></circle><circle cx="15.5" cy="12" r="1.35"></circle><circle cx="8.5" cy="19" r="1.35"></circle><circle cx="15.5" cy="19" r="1.35"></circle></g></svg></button><button type="button" aria-label="Delete table" title="Delete table" class="fixed z-20 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-edge bg-surface text-failure shadow-sm active:border-failure active:bg-failure active:text-surface" style="left: 0px; top: 50px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="trash-simple" viewBox="0 0 24 24" class="size-3.5"><path d="M4.5 6.75h15M9 6.75V4.5c0-.55.45-1 1-1h4c.55 0 1 .45 1 1v2.25m-8.75 0 .6 11.35c.07 1.34 1.17 2.4 2.51 2.4h5.28c1.34 0 2.44-1.06 2.51-2.4l.6-11.35"></path></svg></button></div></div>',
      ],
      tags: [[]],
      events: [
        'selection-change',
        'selection-change',
        'capture:1:Move cells',
        'release:1',
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
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
                { text: '1,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '2,0', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '2,1', colSpan: 1, rowSpan: 1 },
                { text: '2,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
    {
      label: 'Insert column right',
      selection: { kind: 'range', anchor: [0, 2], offset: 0 },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div data-layer="" style="display:contents" data-depth="2"><button type="button" aria-label="Move cells" class="fixed z-20 flex size-6 -translate-x-[calc(100%-3px)] -translate-y-[3px] items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm touch-none cursor-grab" style="left: 200px; top: 80px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="dots-six-vertical" viewBox="0 0 24 24" class="size-3.5"><g fill="currentColor" stroke="none"><circle cx="8.5" cy="5" r="1.35"></circle><circle cx="15.5" cy="5" r="1.35"></circle><circle cx="8.5" cy="12" r="1.35"></circle><circle cx="15.5" cy="12" r="1.35"></circle><circle cx="8.5" cy="19" r="1.35"></circle><circle cx="15.5" cy="19" r="1.35"></circle></g></svg></button><button type="button" aria-label="Delete table" title="Delete table" class="fixed z-20 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-edge bg-surface text-failure shadow-sm active:border-failure active:bg-failure active:text-surface" style="left: 0px; top: 50px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="trash-simple" viewBox="0 0 24 24" class="size-3.5"><path d="M4.5 6.75h15M9 6.75V4.5c0-.55.45-1 1-1h4c.55 0 1 .45 1 1v2.25m-8.75 0 .6 11.35c.07 1.34 1.17 2.4 2.51 2.4h5.28c1.34 0 2.44-1.06 2.51-2.4l.6-11.35"></path></svg></button></div></div>',
      ],
      tags: [[]],
      events: [
        'selection-change',
        'selection-change',
        'capture:1:Move cells',
        'release:1',
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
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
                { text: '1,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '2,0', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '2,1', colSpan: 1, rowSpan: 1 },
                { text: '2,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
    {
      label: 'Delete column',
      selection: { kind: 'range', anchor: [2, 1], offset: 0 },
      portal: ['<div id="mount"></div>'],
      tags: [[]],
      events: [
        'selection-change',
        'selection-change',
        'capture:1:Move cells',
        'release:1',
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
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
                { text: '1,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '2,0', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '2,1', colSpan: 1, rowSpan: 1 },
                { text: '2,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
    {
      label: 'Delete row',
      selection: { kind: 'range', anchor: [1, 0], offset: 0 },
      portal: ['<div id="mount"></div>'],
      tags: [[]],
      events: [
        'selection-change',
        'selection-change',
        'capture:1:Move cells',
        'release:1',
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
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '0,1', colSpan: 1, rowSpan: 1 },
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '2,0', colSpan: 1, rowSpan: 1 },
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '2,1', colSpan: 1, rowSpan: 1 },
                { text: '2,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
  ]);
});

test('touch: menu falls back to the tracked anchor when the live selection is gone', async () => {
  touchDevice.mockReturnValue(true);
  const { editor, tags } = await mount();
  await select(editor, [1, 1]);
  handle().dispatchEvent(
    pointer('pointerdown', { pointerType: 'touch', clientX: 197, clientY: 80 })
  );
  handle().dispatchEvent(
    pointer('pointerup', { pointerType: 'touch', clientX: 197, clientY: 80 })
  );
  await settle();
  await new Promise<void>((resolve) =>
    editor.update(() => $setSelection(null), { onUpdate: () => resolve() })
  );
  snapshot('touch-fallback', 'selection-cleared', editor, tags);
  button('Delete row').click();
  await settle();
  snapshot('touch-fallback', 'delete-row', editor, tags);
  expect(checked['touch-fallback']).toEqual([
    {
      label: 'selection-cleared',
      selection: { kind: 'none' },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div data-layer="" style="display:contents" data-depth="2"><button type="button" aria-label="Move cells" class="fixed z-20 flex size-6 -translate-x-[calc(100%-3px)] -translate-y-[3px] items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm touch-none cursor-grab" style="left: 200px; top: 80px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="dots-six-vertical" viewBox="0 0 24 24" class="size-3.5"><g fill="currentColor" stroke="none"><circle cx="8.5" cy="5" r="1.35"></circle><circle cx="15.5" cy="5" r="1.35"></circle><circle cx="8.5" cy="12" r="1.35"></circle><circle cx="15.5" cy="12" r="1.35"></circle><circle cx="8.5" cy="19" r="1.35"></circle><circle cx="15.5" cy="19" r="1.35"></circle></g></svg></button><button type="button" aria-label="Delete table" title="Delete table" class="fixed z-20 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-edge bg-surface text-failure shadow-sm active:border-failure active:bg-failure active:text-surface" style="left: 0px; top: 50px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="trash-simple" viewBox="0 0 24 24" class="size-3.5"><path d="M4.5 6.75h15M9 6.75V4.5c0-.55.45-1 1-1h4c.55 0 1 .45 1 1v2.25m-8.75 0 .6 11.35c.07 1.34 1.17 2.4 2.51 2.4h5.28c1.34 0 2.44-1.06 2.51-2.4l.6-11.35"></path></svg></button><div class="menu-surface z-30 grid grid-cols-2 gap-1 overflow-y-auto p-1.5" style="width: 104px; max-height: 140px; position: absolute; visibility: visible; left: 7px; top: 9px;"><button type="button" class="flex items-center justify-center rounded-md py-2 ring-1 ring-edge active:bg-accent/10 text-ink-muted" aria-label="Insert column left" title="Insert column left"><span class="relative"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="columns-plus-left" viewBox="0 0 24 24" class="size-5"><rect width="11" height="18" x="10" y="3" rx="2"></rect><path d="M15.5 3v18M2 12h5M4.5 9.5v5"></path></svg></span></button><button type="button" class="flex items-center justify-center rounded-md py-2 ring-1 ring-edge active:bg-accent/10 text-ink-muted" aria-label="Insert column right" title="Insert column right"><span class="relative"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="columns-plus-right" viewBox="0 0 24 24" class="size-5"><rect width="7" height="18" x="3" y="3" rx="2"></rect><path d="M16 3h-1a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h1m2-12.5v7M14.5 12h7"></path></svg></span></button><button type="button" class="flex items-center justify-center rounded-md py-2 ring-1 ring-edge active:bg-accent/10 text-ink-muted" aria-label="Insert row below" title="Insert row below"><span class="relative"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="rows-plus-bottom" viewBox="0 0 24 24" class="size-5"><g transform="rotate(-90 12 12)"><rect width="11" height="18" x="10" y="3" rx="2"></rect><path d="M15.5 3v18M2 12h5M4.5 9.5v5"></path></g></svg></span></button><button type="button" class="flex items-center justify-center rounded-md py-2 ring-1 ring-edge active:bg-accent/10 text-ink-muted" aria-label="Insert row above" title="Insert row above"><span class="relative"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="rows-plus-top" viewBox="0 0 24 24" class="size-5"><g transform="rotate(90 12 12)"><rect width="11" height="18" x="10" y="3" rx="2"></rect><path d="M15.5 3v18M2 12h5M4.5 9.5v5"></path></g></svg></span></button><button type="button" class="flex items-center justify-center rounded-md py-2 ring-1 ring-edge active:bg-accent/10 text-failure" aria-label="Delete row" title="Delete row"><span class="relative"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="rows" viewBox="0 0 24 24" class="size-5"><rect width="18" height="6.5" x="3" y="4" rx="2"></rect><rect width="18" height="6.5" x="3" y="13.5" rx="2"></rect></svg><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="trash-simple" viewBox="0 0 24 24" class="absolute -right-1 -bottom-1 size-3 rounded-full bg-surface"><path d="M4.5 6.75h15M9 6.75V4.5c0-.55.45-1 1-1h4c.55 0 1 .45 1 1v2.25m-8.75 0 .6 11.35c.07 1.34 1.17 2.4 2.51 2.4h5.28c1.34 0 2.44-1.06 2.51-2.4l.6-11.35"></path></svg></span></button><button type="button" class="flex items-center justify-center rounded-md py-2 ring-1 ring-edge active:bg-accent/10 text-failure" aria-label="Delete column" title="Delete column"><span class="relative"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="columns" viewBox="0 0 24 24" class="size-5"><rect width="7" height="18" x="3.5" y="3" rx="2"></rect><rect width="7" height="18" x="13.5" y="3" rx="2"></rect></svg><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="trash-simple" viewBox="0 0 24 24" class="absolute -right-1 -bottom-1 size-3 rounded-full bg-surface"><path d="M4.5 6.75h15M9 6.75V4.5c0-.55.45-1 1-1h4c.55 0 1 .45 1 1v2.25m-8.75 0 .6 11.35c.07 1.34 1.17 2.4 2.51 2.4h5.28c1.34 0 2.44-1.06 2.51-2.4l.6-11.35"></path></svg></span></button></div></div></div>',
      ],
      tags: [],
      events: ['selection-change', 'capture:1:Move cells', 'release:1'],
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
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
                { text: '1,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '2,0', colSpan: 1, rowSpan: 1 },
                { text: '2,1', colSpan: 1, rowSpan: 1 },
                { text: '2,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
    {
      label: 'delete-row',
      selection: { kind: 'range', anchor: [1, 0], offset: 0 },
      portal: ['<div id="mount"></div>'],
      tags: [[]],
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
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '2,0', colSpan: 1, rowSpan: 1 },
                { text: '2,1', colSpan: 1, rowSpan: 1 },
                { text: '2,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
  ]);
});

test('touch: split merged cell and delete table', async () => {
  touchDevice.mockReturnValue(true);
  const { editor, tags } = await mount(async (current) => {
    await buildTable(current, coordGrid(2, 3));
    await new Promise<void>((resolve) =>
      current.update(
        () => {
          const first = $getCell(0, 0);
          const second = $getCell(0, 1);
          if (!$isTableCellNode(first) || !$isTableCellNode(second)) return;
          second.remove();
          first.setColSpan(2);
        },
        { onUpdate: () => resolve() }
      )
    );
  });
  await select(editor, [0, 0]);
  handle().dispatchEvent(
    pointer('pointerdown', { pointerType: 'touch', clientX: 97, clientY: 50 })
  );
  handle().dispatchEvent(
    pointer('pointerup', { pointerType: 'touch', clientX: 97, clientY: 50 })
  );
  await settle();
  snapshot('touch-split', 'menu-open-merged', editor, tags);
  button('Split cell').click();
  await settle();
  snapshot('touch-split', 'split', editor, tags);
  await select(editor, [1, 1]);
  const remove = button('Delete table');
  const down = pointer('pointerdown', { pointerType: 'touch' });
  remove.dispatchEvent(down);
  remove.click();
  await settle();
  snapshot('touch-split', 'delete-table', editor, tags, {
    defaultPrevented: down.defaultPrevented,
  });
  expect(checked['touch-split']).toEqual([
    {
      label: 'menu-open-merged',
      selection: { kind: 'range', anchor: [0, 0], offset: 0 },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div data-layer="" style="display:contents" data-depth="2"><button type="button" aria-label="Move cells" class="fixed z-20 flex size-6 -translate-x-[calc(100%-3px)] -translate-y-[3px] items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm touch-none cursor-grab" style="left: 100px; top: 50px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="dots-six-vertical" viewBox="0 0 24 24" class="size-3.5"><g fill="currentColor" stroke="none"><circle cx="8.5" cy="5" r="1.35"></circle><circle cx="15.5" cy="5" r="1.35"></circle><circle cx="8.5" cy="12" r="1.35"></circle><circle cx="15.5" cy="12" r="1.35"></circle><circle cx="8.5" cy="19" r="1.35"></circle><circle cx="15.5" cy="19" r="1.35"></circle></g></svg></button><button type="button" aria-label="Delete table" title="Delete table" class="fixed z-20 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-edge bg-surface text-failure shadow-sm active:border-failure active:bg-failure active:text-surface" style="left: 0px; top: 50px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="trash-simple" viewBox="0 0 24 24" class="size-3.5"><path d="M4.5 6.75h15M9 6.75V4.5c0-.55.45-1 1-1h4c.55 0 1 .45 1 1v2.25m-8.75 0 .6 11.35c.07 1.34 1.17 2.4 2.51 2.4h5.28c1.34 0 2.44-1.06 2.51-2.4l.6-11.35"></path></svg></button><div class="menu-surface z-30 grid grid-cols-2 gap-1 overflow-y-auto p-1.5" style="width: 104px; max-height: 140px; position: absolute; visibility: visible; left: 7px; top: 9px;"><button type="button" class="flex items-center justify-center rounded-md py-2 ring-1 ring-edge active:bg-accent/10 text-ink-muted" aria-label="Insert column left" title="Insert column left"><span class="relative"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="columns-plus-left" viewBox="0 0 24 24" class="size-5"><rect width="11" height="18" x="10" y="3" rx="2"></rect><path d="M15.5 3v18M2 12h5M4.5 9.5v5"></path></svg></span></button><button type="button" class="flex items-center justify-center rounded-md py-2 ring-1 ring-edge active:bg-accent/10 text-ink-muted" aria-label="Insert column right" title="Insert column right"><span class="relative"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="columns-plus-right" viewBox="0 0 24 24" class="size-5"><rect width="7" height="18" x="3" y="3" rx="2"></rect><path d="M16 3h-1a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h1m2-12.5v7M14.5 12h7"></path></svg></span></button><button type="button" class="flex items-center justify-center rounded-md py-2 ring-1 ring-edge active:bg-accent/10 text-ink-muted" aria-label="Insert row below" title="Insert row below"><span class="relative"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="rows-plus-bottom" viewBox="0 0 24 24" class="size-5"><g transform="rotate(-90 12 12)"><rect width="11" height="18" x="10" y="3" rx="2"></rect><path d="M15.5 3v18M2 12h5M4.5 9.5v5"></path></g></svg></span></button><button type="button" class="flex items-center justify-center rounded-md py-2 ring-1 ring-edge active:bg-accent/10 text-ink-muted" aria-label="Insert row above" title="Insert row above"><span class="relative"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="rows-plus-top" viewBox="0 0 24 24" class="size-5"><g transform="rotate(90 12 12)"><rect width="11" height="18" x="10" y="3" rx="2"></rect><path d="M15.5 3v18M2 12h5M4.5 9.5v5"></path></g></svg></span></button><button type="button" class="flex items-center justify-center rounded-md py-2 ring-1 ring-edge active:bg-accent/10 text-failure" aria-label="Delete row" title="Delete row"><span class="relative"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="rows" viewBox="0 0 24 24" class="size-5"><rect width="18" height="6.5" x="3" y="4" rx="2"></rect><rect width="18" height="6.5" x="3" y="13.5" rx="2"></rect></svg><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="trash-simple" viewBox="0 0 24 24" class="absolute -right-1 -bottom-1 size-3 rounded-full bg-surface"><path d="M4.5 6.75h15M9 6.75V4.5c0-.55.45-1 1-1h4c.55 0 1 .45 1 1v2.25m-8.75 0 .6 11.35c.07 1.34 1.17 2.4 2.51 2.4h5.28c1.34 0 2.44-1.06 2.51-2.4l.6-11.35"></path></svg></span></button><button type="button" class="flex items-center justify-center rounded-md py-2 ring-1 ring-edge active:bg-accent/10 text-failure" aria-label="Delete column" title="Delete column"><span class="relative"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="columns" viewBox="0 0 24 24" class="size-5"><rect width="7" height="18" x="3.5" y="3" rx="2"></rect><rect width="7" height="18" x="13.5" y="3" rx="2"></rect></svg><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="trash-simple" viewBox="0 0 24 24" class="absolute -right-1 -bottom-1 size-3 rounded-full bg-surface"><path d="M4.5 6.75h15M9 6.75V4.5c0-.55.45-1 1-1h4c.55 0 1 .45 1 1v2.25m-8.75 0 .6 11.35c.07 1.34 1.17 2.4 2.51 2.4h5.28c1.34 0 2.44-1.06 2.51-2.4l.6-11.35"></path></svg></span></button><button type="button" aria-label="Split cell" title="Split cell" class="col-span-2 flex items-center justify-center gap-1.5 rounded-md py-2 ring-1 ring-edge active:bg-accent/10 text-ink-muted"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="corners-out" viewBox="0 0 24 24" class="size-4"><path d="M9 4H6.5A2.5 2.5 0 0 0 4 6.5V9m11-5h2.5A2.5 2.5 0 0 1 20 6.5V9M4 15v2.5A2.5 2.5 0 0 0 6.5 20H9m6 0h2.5a2.5 2.5 0 0 0 2.5-2.5V15"></path></svg><span class="text-xs">Split cell</span></button></div></div></div>',
      ],
      tags: [],
      events: ['selection-change', 'capture:1:Move cells', 'release:1'],
      model: [
        {
          type: 'table',
          colWidths: null,
          rows: [
            {
              height: null,
              cells: [
                { text: '0,0', colSpan: 2, rowSpan: 1 },
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
                { text: '1,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
    {
      label: 'split',
      selection: { kind: 'range', anchor: [0, 0], offset: 0 },
      portal: [
        '<div id="mount"><div class="hidden"></div></div>',
        '<div><div data-layer="" style="display:contents" data-depth="2"><button type="button" aria-label="Move cells" class="fixed z-20 flex size-6 -translate-x-[calc(100%-3px)] -translate-y-[3px] items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm touch-none cursor-grab" style="left: 100px; top: 50px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="dots-six-vertical" viewBox="0 0 24 24" class="size-3.5"><g fill="currentColor" stroke="none"><circle cx="8.5" cy="5" r="1.35"></circle><circle cx="15.5" cy="5" r="1.35"></circle><circle cx="8.5" cy="12" r="1.35"></circle><circle cx="15.5" cy="12" r="1.35"></circle><circle cx="8.5" cy="19" r="1.35"></circle><circle cx="15.5" cy="19" r="1.35"></circle></g></svg></button><button type="button" aria-label="Delete table" title="Delete table" class="fixed z-20 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-edge bg-surface text-failure shadow-sm active:border-failure active:bg-failure active:text-surface" style="left: 0px; top: 50px;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true" data-macro-icon="trash-simple" viewBox="0 0 24 24" class="size-3.5"><path d="M4.5 6.75h15M9 6.75V4.5c0-.55.45-1 1-1h4c.55 0 1 .45 1 1v2.25m-8.75 0 .6 11.35c.07 1.34 1.17 2.4 2.51 2.4h5.28c1.34 0 2.44-1.06 2.51-2.4l.6-11.35"></path></svg></button></div></div>',
      ],
      tags: [[]],
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
                { text: '', colSpan: 1, rowSpan: 1 },
                { text: '0,2', colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              height: null,
              cells: [
                { text: '1,0', colSpan: 1, rowSpan: 1 },
                { text: '1,1', colSpan: 1, rowSpan: 1 },
                { text: '1,2', colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
        { type: 'paragraph', text: 'after' },
      ],
    },
    {
      label: 'delete-table',
      selection: { kind: 'range', anchor: 'paragraph', offset: 0 },
      portal: ['<div id="mount"></div>'],
      tags: [[]],
      events: ['selection-change'],
      defaultPrevented: true,
      model: [{ type: 'paragraph', text: 'after' }],
    },
  ]);
});
