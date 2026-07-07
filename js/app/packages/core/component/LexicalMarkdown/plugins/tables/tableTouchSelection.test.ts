import { registerRichText } from '@lexical/rich-text';
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $getTableCellNodeFromLexicalNode,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  $isTableSelection,
  TableCellHeaderStates,
  type TableCellNode,
} from '@lexical/table';
import { SupportedNodeTypes } from '@lexical-core/node-list';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tablePlugin } from './tablePlugin';
import { tableTouchSelectionPlugin } from './tableTouchSelection';

// jsdom implements neither PointerEvent nor elementsFromPoint. The plugin
// only reads pointerType/pointerId/isPrimary/coordinates from events, and
// hit-testing is redirected through this controllable stub.
class PolyfillPointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  constructor(
    type: string,
    init: MouseEventInit & {
      pointerId?: number;
      pointerType?: string;
      isPrimary?: boolean;
    } = {}
  ) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? '';
    this.isPrimary = init.isPrimary ?? false;
  }
}
if (typeof globalThis.PointerEvent === 'undefined') {
  globalThis.PointerEvent =
    PolyfillPointerEvent as unknown as typeof PointerEvent;
}

let elementsUnderPointer: Element[] = [];
document.elementsFromPoint = () => elementsUnderPointer;

function createTestEditor(): LexicalEditor {
  const editor = createEditor({
    namespace: 'table-touch-selection-test',
    nodes: SupportedNodeTypes,
    onError: (error) => {
      throw error;
    },
  });
  tablePlugin({
    hasCellMerge: true,
    hasCellBackgroundColor: true,
    hasTabHandler: true,
  })(editor);
  tableTouchSelectionPlugin()(editor);
  registerRichText(editor);
  const rootElement = document.createElement('div');
  rootElement.contentEditable = 'true';
  document.body.appendChild(rootElement);
  editor.setRootElement(rootElement);
  return editor;
}

async function buildTable(
  editor: LexicalEditor,
  rows: number,
  columns: number
) {
  await new Promise<void>((resolve) => {
    editor.update(
      () => {
        const table = $createTableNode();
        for (let r = 0; r < rows; r++) {
          const row = $createTableRowNode();
          for (let c = 0; c < columns; c++) {
            const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
            const paragraph = $createParagraphNode();
            paragraph.append($createTextNode(`${r},${c}`));
            cell.append(paragraph);
            row.append(cell);
          }
          table.append(row);
        }
        $getRoot().clear().append(table);
      },
      { onUpdate: () => resolve() }
    );
  });
}

function getCellNode(editor: LexicalEditor, row: number, column: number) {
  return editor.getEditorState().read(() => {
    const table = $getRoot().getFirstChild();
    if (!$isTableNode(table)) throw new Error('no table');
    const rowNode = table.getChildren().filter($isTableRowNode)[row];
    return rowNode.getChildren().filter($isTableCellNode)[column];
  });
}

function getCellElement(
  editor: LexicalEditor,
  row: number,
  column: number
): HTMLElement {
  const elem = editor.getElementByKey(
    getCellNode(editor, row, column).getKey()
  );
  if (!elem) throw new Error('no cell element');
  return elem;
}

function touchEvent(
  type: string,
  init: { clientX?: number; clientY?: number } = {}
): PointerEvent {
  return new PolyfillPointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    isPrimary: true,
    pointerId: 1,
    pointerType: 'touch',
  }) as unknown as PointerEvent;
}

/** Anchor and focus cell of the current selection, or null when not a table selection. */
function readTableSelection(
  editor: LexicalEditor
): { anchor: TableCellNode; focus: TableCellNode } | null {
  return editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isTableSelection(selection)) return null;
    const anchor = $getTableCellNodeFromLexicalNode(selection.anchor.getNode());
    const focus = $getTableCellNodeFromLexicalNode(selection.focus.getNode());
    return anchor && focus ? { anchor, focus } : null;
  });
}

async function flush() {
  await Promise.resolve();
}

describe('table touch selection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    elementsUnderPointer = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('selects the pressed cell after a long press', async () => {
    const editor = createTestEditor();
    await buildTable(editor, 3, 3);
    const cellElem = getCellElement(editor, 1, 1);

    cellElem.dispatchEvent(touchEvent('pointerdown'));
    vi.advanceTimersByTime(500);
    await flush();

    const selection = readTableSelection(editor);
    expect(selection).not.toBeNull();
    const pressedKey = getCellNode(editor, 1, 1).getKey();
    expect(selection?.anchor.getKey()).toBe(pressedKey);
    expect(selection?.focus.getKey()).toBe(pressedKey);
  });

  it('extends the selection while swiping across cells', async () => {
    const editor = createTestEditor();
    await buildTable(editor, 3, 3);

    getCellElement(editor, 0, 0).dispatchEvent(touchEvent('pointerdown'));
    vi.advanceTimersByTime(500);
    await flush();

    elementsUnderPointer = [getCellElement(editor, 2, 1)];
    document.dispatchEvent(
      touchEvent('pointermove', { clientX: 50, clientY: 80 })
    );
    await flush();

    const selection = readTableSelection(editor);
    expect(selection?.anchor.getKey()).toBe(getCellNode(editor, 0, 0).getKey());
    expect(selection?.focus.getKey()).toBe(getCellNode(editor, 2, 1).getKey());
  });

  it('keeps the selection after the finger lifts', async () => {
    const editor = createTestEditor();
    await buildTable(editor, 2, 2);

    getCellElement(editor, 0, 0).dispatchEvent(touchEvent('pointerdown'));
    vi.advanceTimersByTime(500);
    await flush();
    elementsUnderPointer = [getCellElement(editor, 1, 1)];
    document.dispatchEvent(
      touchEvent('pointermove', { clientX: 40, clientY: 40 })
    );
    await flush();
    document.dispatchEvent(
      touchEvent('pointerup', { clientX: 40, clientY: 40 })
    );
    await flush();

    const selection = readTableSelection(editor);
    expect(selection?.focus.getKey()).toBe(getCellNode(editor, 1, 1).getKey());
  });

  it('does nothing when the finger drifts before the long press fires', async () => {
    const editor = createTestEditor();
    await buildTable(editor, 2, 2);

    getCellElement(editor, 0, 0).dispatchEvent(
      touchEvent('pointerdown', { clientX: 0, clientY: 0 })
    );
    document.dispatchEvent(
      touchEvent('pointermove', { clientX: 0, clientY: 30 })
    );
    vi.advanceTimersByTime(500);
    await flush();

    expect(readTableSelection(editor)).toBeNull();
  });

  it('does nothing on a quick tap', async () => {
    const editor = createTestEditor();
    await buildTable(editor, 2, 2);

    getCellElement(editor, 0, 0).dispatchEvent(touchEvent('pointerdown'));
    document.dispatchEvent(touchEvent('pointerup'));
    vi.advanceTimersByTime(500);
    await flush();

    expect(readTableSelection(editor)).toBeNull();
  });

  it('ignores mouse pointers', async () => {
    const editor = createTestEditor();
    await buildTable(editor, 2, 2);

    getCellElement(editor, 0, 0).dispatchEvent(
      new PolyfillPointerEvent('pointerdown', {
        bubbles: true,
        isPrimary: true,
        pointerId: 1,
        pointerType: 'mouse',
      })
    );
    vi.advanceTimersByTime(500);
    await flush();

    expect(readTableSelection(editor)).toBeNull();
  });

  it('blocks scrolling only while selecting', async () => {
    const editor = createTestEditor();
    await buildTable(editor, 2, 2);
    const cellElem = getCellElement(editor, 0, 0);

    cellElem.dispatchEvent(touchEvent('pointerdown'));

    // Armed but not yet selecting: scrolling must stay possible.
    const armedScroll = new Event('touchmove', { cancelable: true });
    document.dispatchEvent(armedScroll);
    expect(armedScroll.defaultPrevented).toBe(false);

    vi.advanceTimersByTime(500);
    await flush();

    const selectingScroll = new Event('touchmove', { cancelable: true });
    document.dispatchEvent(selectingScroll);
    expect(selectingScroll.defaultPrevented).toBe(true);

    document.dispatchEvent(touchEvent('pointerup'));
    const afterScroll = new Event('touchmove', { cancelable: true });
    document.dispatchEvent(afterScroll);
    expect(afterScroll.defaultPrevented).toBe(false);
  });

  it('suppresses the long-press context menu during the gesture', async () => {
    const editor = createTestEditor();
    await buildTable(editor, 2, 2);
    const cellElem = getCellElement(editor, 0, 0);

    cellElem.dispatchEvent(touchEvent('pointerdown'));
    vi.advanceTimersByTime(500);
    await flush();

    const menu = new Event('contextmenu', { bubbles: true, cancelable: true });
    cellElem.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);

    document.dispatchEvent(touchEvent('pointerup'));
    const menuAfter = new Event('contextmenu', {
      bubbles: true,
      cancelable: true,
    });
    cellElem.dispatchEvent(menuAfter);
    expect(menuAfter.defaultPrevented).toBe(false);
  });
});
