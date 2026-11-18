/** @vitest-environment jsdom */
/**
 * Source counter controls for the move handle's desktop tap. selectHandleCells
 * (TableMoveHandle.tsx) runs a non-discrete editor.update that sets a table
 * selection, then dispatches SELECTION_CHANGE_COMMAND unconditionally. The
 * real popup plugin is the subscriber. These record the actual order of the
 * command, the popup, and the commit, as the oracle for the native
 * select-cells plugin event.
 */
import {
  $createTableNode,
  $createTableRowNode,
  $createTableSelection,
  $getTableNodeFromLexicalNodeOrThrow,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  $isTableSelection,
} from '@lexical/table';
import {
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $setSelection,
  COMMAND_PRIORITY_CRITICAL,
  type LexicalEditor,
  SELECTION_CHANGE_COMMAND,
} from 'lexical';
import { afterEach, expect, test } from 'vitest';
import { popupPlugin } from '../popup';
import {
  $createTextCell,
  $getTable,
  buildTable,
  createTableTestEditor,
  textGrid,
} from './tableTestUtils';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

type Event =
  | { at: 'command'; pending: string; committed: string }
  | { at: 'popup'; visible: boolean }
  | { at: 'commit'; committed: string };

/** Table selection as "anchor>focus" cell texts, or the selection kind. */
function describe(editor: LexicalEditor, pending: boolean) {
  const read = () => {
    const selection = $getSelection();
    if (!$isTableSelection(selection)) return selection ? 'other' : 'none';
    const text = (key: string) => $getNodeByKey(key)?.getTextContent() ?? '?';
    return `${text(selection.anchor.key)}>${text(selection.focus.key)}`;
  };
  return pending ? read() : editor.getEditorState().read(read);
}

async function setup(onError?: (error: Error) => void) {
  const editor = createTableTestEditor(onError ? { onError } : {});
  cleanups.push(() => editor.getRootElement()?.remove());
  await buildTable(
    editor,
    textGrid([
      ['A1', 'A2'],
      ['B1', 'B2'],
    ])
  );
  const events: Event[] = [];
  cleanups.push(
    popupPlugin({
      setIsPopupVisible: (visible) => {
        events.push({ at: 'popup', visible });
        return true;
      },
      setSelection: () => {},
    })(editor)
  );
  // Highest priority, so it observes the command before the popup handles it.
  cleanups.push(
    editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        events.push({
          at: 'command',
          pending: describe(editor, true),
          committed: describe(editor, false),
        });
        return false;
      },
      COMMAND_PRIORITY_CRITICAL
    )
  );
  cleanups.push(
    editor.registerUpdateListener(() => {
      events.push({ at: 'commit', committed: describe(editor, false) });
    })
  );
  return { editor, events };
}

/** TableMoveHandle selectHandleCells, verbatim in shape. */
function selectHandleCells(
  editor: LexicalEditor,
  anchorKey: string | undefined,
  focusKey: string | undefined
) {
  editor.update(() => {
    const anchorCell = anchorKey ? $getNodeByKey(anchorKey) : null;
    const focusCell = focusKey ? $getNodeByKey(focusKey) : null;
    if (
      !$isTableCellNode(anchorCell) ||
      !$isTableCellNode(focusCell) ||
      !anchorCell.isAttached() ||
      !focusCell.isAttached()
    ) {
      return;
    }
    const table = $getTableNodeFromLexicalNodeOrThrow(anchorCell);
    const tableSelection = $createTableSelection();
    tableSelection.set(table.getKey(), anchorCell.getKey(), focusCell.getKey());
    $setSelection(tableSelection);
  });
  editor.dispatchCommand(SELECTION_CHANGE_COMMAND, undefined);
}
/** Past the update's microtask commit and its DOM selectionchange. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function cellKeys(editor: LexicalEditor) {
  return editor.getEditorState().read(() =>
    $getTable()
      .getChildren()
      .filter($isTableRowNode)
      .flatMap((row) => row.getChildren().map((cell) => cell.getKey()))
  );
}

test('a tap that changes the selection notifies twice: explicit (pending) then reconcile (committed)', async () => {
  const { editor, events } = await setup();
  const [a1] = cellKeys(editor);
  selectHandleCells(editor, a1, a1);
  await settle();
  expect(events).toEqual([
    // selectHandleCells' own dispatch runs before the non-discrete update commits.
    { at: 'command', pending: 'A1>A1', committed: 'none' },
    { at: 'popup', visible: false },
    { at: 'popup', visible: true },
    // Lexical's own SELECTION_CHANGE from the reconciled DOM selection (jsdom
    // selectionchange), against the committed selection, before update listeners.
    { at: 'command', pending: 'A1>A1', committed: 'A1>A1' },
    { at: 'popup', visible: false },
    { at: 'popup', visible: true },
    { at: 'commit', committed: 'A1>A1' },
  ]);
});

test('a repeated tap on the same cells notifies exactly once; no selection changed', async () => {
  const { editor, events } = await setup();
  const [a1] = cellKeys(editor);
  selectHandleCells(editor, a1, a1);
  await settle();
  events.length = 0;
  selectHandleCells(editor, a1, a1);
  await settle();
  expect(events.filter((event) => event.at !== 'commit')).toEqual([
    { at: 'command', pending: 'A1>A1', committed: 'A1>A1' },
    { at: 'popup', visible: false },
    { at: 'popup', visible: true },
  ]);
});

test('changed cells notify explicitly against the new pending selection, then on reconcile', async () => {
  const { editor, events } = await setup();
  const [a1, , , b2] = cellKeys(editor);
  selectHandleCells(editor, a1, a1);
  await settle();
  events.length = 0;
  selectHandleCells(editor, a1, b2);
  await settle();
  expect(events.filter((event) => event.at !== 'commit')).toEqual([
    { at: 'command', pending: 'A1>B2', committed: 'A1>A1' },
    { at: 'popup', visible: false },
    { at: 'popup', visible: true },
    { at: 'command', pending: 'A1>B2', committed: 'A1>B2' },
    { at: 'popup', visible: false },
    { at: 'popup', visible: true },
  ]);
});

test('a detached tracked cell: the update is a no-op, the command still fires once', async () => {
  const { editor, events } = await setup();
  const [a1, , b1] = cellKeys(editor);
  selectHandleCells(editor, a1, a1);
  await settle();
  await new Promise<void>((resolve) =>
    editor.update(
      () =>
        $getNodeByKey(b1 ?? '')
          ?.getParent()
          ?.remove(),
      {
        onUpdate: () => resolve(),
      }
    )
  );
  await settle();
  events.length = 0;
  selectHandleCells(editor, b1, b1);
  await settle();
  // No selection is set, yet the popup hides and re-shows the current one.
  expect(events.filter((event) => event.at !== 'commit')).toEqual([
    { at: 'command', pending: 'A1>A1', committed: 'A1>A1' },
    { at: 'popup', visible: false },
    { at: 'popup', visible: true },
  ]);
});

test('missing tracked keys: the command still fires; with no selection the popup only hides', async () => {
  const { editor, events } = await setup();
  selectHandleCells(editor, undefined, undefined);
  await settle();
  expect(events.filter((event) => event.at !== 'commit')).toEqual([
    { at: 'command', pending: 'none', committed: 'none' },
    { at: 'popup', visible: false },
  ]);
});

// The app's editor onError reports without throwing (LexicalWrapperContext),
// as this test's recorder does: Lexical discards the failed update.
test('anchor and focus in different tables: the table plugin reports an invariant error and the selection never commits', async () => {
  // Lexical routes update errors to onError; record each instead of throwing.
  const errors: string[] = [];
  const { editor, events } = await setup((error) => errors.push(error.message));
  // A second table after the first; the handle can only track cells of one table,
  // so this pins what selectHandleCells does if its corners straddle two.
  await new Promise<void>((resolve) =>
    editor.update(
      () => {
        const second = $createTableNode();
        for (const texts of [
          ['C1', 'C2'],
          ['D1', 'D2'],
        ]) {
          const row = $createTableRowNode();
          row.append(...texts.map((text) => $createTextCell(text)));
          second.append(row);
        }
        $getRoot().append(second);
      },
      { onUpdate: () => resolve() }
    )
  );
  await settle();
  const keys = editor.getEditorState().read(() =>
    $getRoot()
      .getChildren()
      .filter($isTableNode)
      .map((table) =>
        table
          .getChildren()
          .filter($isTableRowNode)
          .flatMap((row) => row.getChildren().map((cell) => cell.getKey()))
      )
  );
  const [first, second] = keys;
  const a1 = first?.[0];
  const d2 = second?.[3];
  events.length = 0;
  let thrown: unknown;
  try {
    selectHandleCells(editor, a1, d2);
  } catch (error) {
    thrown = error;
  }
  await settle();
  const facts = editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isTableSelection(selection))
      return { kind: selection ? 'other' : 'none' };
    const table = $getNodeByKey(selection.tableKey);
    return {
      kind: 'table',
      table:
        $isTableNode(table) && table.getTextContent().includes('A1')
          ? 'first'
          : 'other',
      anchor: $getNodeByKey(selection.anchor.key)?.getTextContent(),
      focus: $getNodeByKey(selection.focus.key)?.getTextContent(),
      isValid: selection.isValid(),
    };
  });
  expect({
    thrown: thrown instanceof Error ? thrown.message : thrown,
    errors,
    facts,
    events,
  }).toEqual({
    thrown: undefined,
    errors: [
      'Expected TableSelection anchor and focus to be in the same table',
    ],
    facts: { kind: 'none' },
    events: [
      // The explicit dispatch still reaches observers once, against the pending straddle.
      { at: 'command', pending: 'A1>D2', committed: 'none' },
      { at: 'commit', committed: 'none' },
      { at: 'popup', visible: false },
    ],
  });
});
