import { writeFileSync } from 'node:fs';
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
} from '@lexical/table';
import { DateMentionNode } from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $nodesOfType,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  type LexicalEditor,
} from 'lexical';
import { expect, test, vi } from 'vitest';
import {
  INSERT_DATE_MENTION_COMMAND,
  mentionsPlugin,
} from '../plugins/mentions/mentionsPlugin';
import { behaviorEditor } from './editor';

vi.hoisted(() => {
  vi.stubGlobal(
    'WebSocket',
    class {
      readyState = 1;
      close() {}
      addEventListener() {}
      removeEventListener() {}
      send() {}
    }
  );
});
const captures: unknown[] = [];
const identities = new WeakMap<object, number>();
let nextIdentity = 1;
function selectionSnapshot() {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  if (!identities.has(selection)) identities.set(selection, nextIdentity++);
  const path: { key: string; type: string; index: number }[] = [];
  let node = selection.anchor.getNode();
  for (;;) {
    path.push({
      key: node.getKey(),
      type: node.getType(),
      index: node.getIndexWithinParent(),
    });
    const parent = node.getParent();
    if (!parent) break;
    node = parent;
  }
  return {
    identity: identities.get(selection),
    anchor: {
      key: selection.anchor.key,
      type: selection.anchor.type,
      offset: selection.anchor.offset,
    },
    focus: {
      key: selection.focus.key,
      type: selection.focus.type,
      offset: selection.focus.offset,
    },
    path,
    format: selection.format,
  };
}
function capture(editor: LexicalEditor) {
  return editor.read(() => ({
    json: editor.getEditorState().toJSON(),
    text: $getRoot().getTextContent(),
    selection: selectionSnapshot(),
    dates: $nodesOfType(DateMentionNode).map((node) => ({
      json: node.exportJSON(),
      parentKey: node.getParent()?.getKey() ?? null,
    })),
  }));
}
for (const mode of [
  'virtual-cell-select',
  'forced-committed-cell',
  'forced-active-cell',
] as const)
  test(`actual Source Date command entry after ${mode}`, () => {
    const { editor } = behaviorEditor(mentionsPlugin({}));
    let cellKey = '';
    let paragraphKey = '';
    function forceCellRange() {
      const range = $createRangeSelection();
      range.anchor.set(cellKey, 1, 'element');
      range.focus.set(cellKey, 1, 'element');
      $setSelection(range);
    }
    editor.update(
      () => {
        const root = $getRoot();
        root.append($createParagraphNode().append($createTextNode('body')));
        const paragraph = $createParagraphNode().append(
          $createTextNode('cell')
        );
        const cell = $createTableCellNode().append(paragraph);
        root.append(
          $createTableNode().append($createTableRowNode().append(cell))
        );
        cellKey = cell.getKey();
        paragraphKey = paragraph.getKey();
        if (mode === 'forced-committed-cell') forceCellRange();
        else cell.select(1, 1);
      },
      { discrete: true }
    );
    const before = capture(editor);
    const entries: ReturnType<typeof selectionSnapshot>[] = [];
    const release = editor.registerCommand(
      INSERT_DATE_MENTION_COMMAND,
      () => {
        entries.push(selectionSnapshot());
        return false;
      },
      COMMAND_PRIORITY_HIGH
    );
    const activeFrame: { before: ReturnType<typeof selectionSnapshot> } = {
      before: null,
    };
    const outcome: { handled?: boolean; threw: boolean; message?: string } = {
      threw: false,
    };
    const insert = () =>
      editor.dispatchCommand(INSERT_DATE_MENTION_COMMAND, {
        date: '2026-06-15T12:00:00.000Z',
        displayFormat: 'Today',
      });
    try {
      if (mode === 'forced-active-cell') {
        editor.update(
          () => {
            forceCellRange();
            activeFrame.before = selectionSnapshot();
            outcome.handled = insert();
          },
          { discrete: true }
        );
      } else outcome.handled = insert();
    } catch (error) {
      outcome.threw = true;
      outcome.message = error instanceof Error ? error.message : typeof error;
    } finally {
      release();
    }
    const after = capture(editor);
    captures.push({
      mode,
      cellKey,
      paragraphKey,
      before,
      activeBefore: activeFrame.before,
      entries,
      outcome,
      after,
    });
    if (process.env.SOURCE_DATE_CELL_ENDPOINT_OUTPUT)
      writeFileSync(
        process.env.SOURCE_DATE_CELL_ENDPOINT_OUTPUT,
        JSON.stringify(captures, null, 2)
      );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.anchor).toEqual(entries[0]?.focus);
    if (mode === 'virtual-cell-select') {
      expect(before.selection?.anchor).toEqual({
        key: paragraphKey,
        type: 'element',
        offset: 1,
      });
      expect(outcome).toEqual({ threw: false, handled: true });
      expect(after.dates).toHaveLength(1);
      expect(after.dates[0].parentKey).toBe(paragraphKey);
      expect(after.selection?.anchor).toEqual({
        key: paragraphKey,
        type: 'element',
        offset: 2,
      });
    } else if (mode === 'forced-committed-cell') {
      expect(before.selection?.anchor).toEqual({
        key: cellKey,
        type: 'element',
        offset: 1,
      });
      expect(outcome).toEqual({ threw: false, handled: true });
      expect(after.dates).toHaveLength(1);
      expect(after.dates[0].parentKey).toBe(paragraphKey);
    } else {
      expect(activeFrame.before?.anchor).toEqual({
        key: cellKey,
        type: 'element',
        offset: 1,
      });
      expect(entries[0]?.anchor).toEqual(activeFrame.before?.anchor);
      expect(entries[0]?.identity).toBe(activeFrame.before?.identity);
      expect(outcome.threw).toBe(true);
      expect(outcome.message).toMatch(/block ElementNode ancestor/);
    }
  });
