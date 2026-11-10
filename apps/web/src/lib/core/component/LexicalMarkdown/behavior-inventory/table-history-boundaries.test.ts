import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import { registerRichText } from '@lexical/rich-text';
import { $createTableNodeWithDimensions, $isTableNode } from '@lexical/table';
import { mergeRegister } from '@lexical/utils';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  HISTORY_MERGE_TAG,
  HISTORY_PUSH_TAG,
  REDO_COMMAND,
  UNDO_COMMAND,
} from 'lexical';
import { afterEach, expect, test, vi } from 'vitest';
import { behaviorEditor } from './editor';

afterEach(() => vi.useRealTimers());

test('Source keeps a table when undoing a resize started within the history delay', () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const { editor } = behaviorEditor((editor) =>
    mergeRegister(
      registerRichText(editor),
      registerHistory(editor, createEmptyHistoryState(), 400)
    )
  );
  editor.update(
    () => {
      $getRoot()
        .append($createParagraphNode().append($createTextNode('base')))
        .selectEnd();
    },
    { discrete: true, tag: HISTORY_PUSH_TAG }
  );
  editor.update(
    () => {
      const table = $createTableNodeWithDimensions(1, 2, false);
      table.setColWidths([160, 160]);
      $getRoot().append(table);
      table.selectStart();
    },
    { discrete: true }
  );
  const before = editor.getEditorState().toJSON();
  for (const [time, width] of [
    [100, 180],
    [200, 210],
  ]) {
    vi.setSystemTime(time);
    editor.update(
      () => {
        const table = $getRoot().getLastChild();
        if (!$isTableNode(table)) throw new Error('Missing actual table');
        table.setColWidths([width, 160]);
      },
      {
        discrete: true,
        tag:
          time === 100
            ? 'skip-scroll-into-view'
            : ['skip-scroll-into-view', HISTORY_MERGE_TAG],
      }
    );
  }
  const after = editor.getEditorState().toJSON();
  expect(after).not.toEqual(before);
  editor.dispatchCommand(UNDO_COMMAND, undefined);
  editor.read(() => {});
  expect(editor.getEditorState().toJSON()).toEqual(before);
  editor.dispatchCommand(REDO_COMMAND, undefined);
  editor.read(() => {});
  expect(editor.getEditorState().toJSON()).toEqual(after);
});

test.each([
  'typing',
  'paste',
  'format',
  'node-insert',
  'explicit-push',
] as const)('Source history keeps the %s boundary within its delay', (kind) => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const { editor } = behaviorEditor((editor) =>
    mergeRegister(
      registerRichText(editor),
      registerHistory(editor, createEmptyHistoryState(), 400)
    )
  );
  editor.update(
    () => {
      $getRoot()
        .append($createParagraphNode().append($createTextNode('a')))
        .selectEnd();
    },
    { discrete: true, tag: HISTORY_PUSH_TAG }
  );
  vi.setSystemTime(100);
  editor.update(
    () => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection))
        throw new Error('Missing actual range');
      selection.insertText('b');
    },
    { discrete: true }
  );
  const before = editor.getEditorState().toJSON();
  vi.setSystemTime(200);
  editor.update(
    () => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection))
        throw new Error('Missing actual range');
      if (kind === 'typing' || kind === 'explicit-push')
        selection.insertText('c');
      else if (kind === 'paste') selection.insertRawText('pasted');
      else if (kind === 'format') {
        const text = $getRoot().getFirstDescendant();
        if (!$isTextNode(text)) throw new Error('Missing actual text');
        text.setFormat('bold');
      } else
        $getRoot()
          .append($createParagraphNode().append($createTextNode('new')))
          .selectEnd();
    },
    {
      discrete: true,
      tag: kind === 'explicit-push' ? HISTORY_PUSH_TAG : undefined,
    }
  );
  const after = editor.getEditorState().toJSON();
  editor.dispatchCommand(UNDO_COMMAND, undefined);
  editor.read(() => {});
  if (kind === 'typing') {
    expect(editor.read(() => $getRoot().getTextContent())).toBe('a');
  } else expect(editor.getEditorState().toJSON()).toEqual(before);
  editor.dispatchCommand(REDO_COMMAND, undefined);
  editor.read(() => {});
  expect(editor.getEditorState().toJSON()).toEqual(after);
});

test('Source cold text writes without a preceding selection keep the first edit as a separate undo entry', () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const { editor } = behaviorEditor((editor) =>
    mergeRegister(
      registerRichText(editor),
      registerHistory(editor, createEmptyHistoryState(), 400)
    )
  );
  editor.update(
    () => {
      $getRoot().append($createParagraphNode().append($createTextNode('a')));
      $setSelection(null);
    },
    { discrete: true }
  );
  for (const [time, value] of [
    [1, 'ab'],
    [2, 'abc'],
  ] as const) {
    vi.setSystemTime(time);
    editor.update(
      () => {
        const text = $getRoot().getFirstDescendant();
        if (!$isTextNode(text)) throw new Error('Missing actual text');
        text.setTextContent(value).select(value.length, value.length);
      },
      { discrete: true }
    );
  }
  editor.dispatchCommand(UNDO_COMMAND, undefined);
  editor.read(() => {});
  expect(editor.read(() => $getRoot().getTextContent())).toBe('ab');
  editor.dispatchCommand(REDO_COMMAND, undefined);
  editor.read(() => {});
  expect(editor.read(() => $getRoot().getTextContent())).toBe('abc');
});

test.each(['code', 'custom-code'])(
  'Source structural SetState(%s) remains after undoing its first typed character',
  (type) => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { editor } = behaviorEditor((editor) =>
      mergeRegister(
        registerRichText(editor),
        registerHistory(editor, createEmptyHistoryState(), 400)
      )
    );
    editor.update(
      () => {
        $getRoot().append($createParagraphNode()).selectStart();
      },
      { discrete: true }
    );
    editor.setEditorState(
      editor.parseEditorState(
        JSON.stringify({
          root: {
            type: 'root',
            children: [
              {
                type,
                children: [{ type: 'text', text: 'const localValue = 1;' }],
              },
              { type: 'paragraph', children: [] },
            ],
          },
        })
      )
    );
    editor.read(() => {});
    const before = editor.getEditorState().toJSON();
    editor.update(
      () => {
        const text = $getRoot().getFirstDescendant();
        if (!$isTextNode(text)) throw new Error('Missing actual code text');
        text.select(21, 21);
        const selection = $getSelection();
        if (!$isRangeSelection(selection))
          throw new Error('Missing actual code range');
        selection.insertText('x');
      },
      { discrete: true }
    );
    const after = editor.getEditorState().toJSON();
    editor.dispatchCommand(UNDO_COMMAND, undefined);
    editor.read(() => {});
    expect(editor.getEditorState().toJSON()).toEqual(before);
    editor.dispatchCommand(REDO_COMMAND, undefined);
    editor.read(() => {});
    expect(editor.getEditorState().toJSON()).toEqual(after);
  }
);
