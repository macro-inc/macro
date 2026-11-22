/** @vitest-environment jsdom */
/**
 * Source oracle for a GIF commit whose captured NodeSelection or TableSelection
 * was detached before the upload finished. lexical-gif.ts rechecks attachment
 * only for a RangeSelection; these record what Source does for the other kinds.
 */
import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import {
  $createTableNode,
  $createTableRowNode,
  $createTableSelection,
  $isTableSelection,
  type TableCellNode,
} from '@lexical/table';
import { $createImageNode, SupportedNodeTypes } from '@macro-inc/lexical-core';
import {
  $createNodeSelection,
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isNodeSelection,
  $isRangeSelection,
  $setSelection,
  type BaseSelection,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import { expect, test } from 'vitest';
import { createLexicalGifMenuHost } from '../../editing/overlay-hosts/lexical-gif';
import { createPluginManager } from '../pluginManager';
import { $createTextCell } from '../tables/tableTestUtils';

const GIF = {
  id: 'fixture-gif',
  title: 'Gif title',
  previewUrl: 'https://example.test/preview.gif',
  url: 'https://example.test/source.gif',
  width: 800,
  height: 400,
};
const FILE_ID = 'detached-static-file';

function mount() {
  const editor = createEditor({
    nodes: [...SupportedNodeTypes],
    onError(error) {
      throw error;
    },
  });
  const plugins = createPluginManager(editor, 'markdown-sync');
  const element = document.createElement('div');
  document.body.appendChild(element);
  editor.setRootElement(element);
  const host = createLexicalGifMenuHost(
    () => editor,
    () => plugins
  );
  const history = createEmptyHistoryState();
  const stopHistory = registerHistory(editor, history, 0);
  const dispose = () => {
    stopHistory();
    plugins.cleanup();
    editor.setRootElement(null);
    element.remove();
  };
  return { editor, host, history, dispose };
}

/** Where the file ended up: the root child types, in order. */
function rootTypes(editor: LexicalEditor) {
  return editor.getEditorState().read(() =>
    $getRoot()
      .getChildren()
      .map((node) => ({
        type: node.getType(),
        text: node.getTextContent(),
        hasFile: JSON.stringify(node.exportJSON()).includes(FILE_ID),
      }))
  );
}

/** Selection kind and its keys, named by the fixture (unnamed keys by type). */
function describeSelection(editor: LexicalEditor, names: Map<string, string>) {
  return editor.getEditorState().read(() => {
    const name = (key: string) =>
      names.get(key) ?? `unnamed:${$getNodeByKey(key)?.getType() ?? 'missing'}`;
    const selection = $getSelection();
    if ($isNodeSelection(selection))
      // _nodes keeps removed keys; getNodes() would drop them.
      return { kind: 'node', keys: [...selection._nodes].map(name) };
    if ($isTableSelection(selection))
      return {
        kind: 'table',
        table: name(selection.tableKey),
        anchor: name(selection.anchor.key),
        focus: name(selection.focus.key),
      };
    if ($isRangeSelection(selection))
      return {
        kind: 'range',
        anchor: [name(selection.anchor.key), selection.anchor.offset],
        focus: [name(selection.focus.key), selection.focus.offset],
      };
    return { kind: 'none' };
  });
}

function commitCaptured(
  runtime: ReturnType<typeof mount>,
  target: BaseSelection | null,
  names: Map<string, string>,
  detach: () => void
) {
  const insertion = runtime.host.prepareInsertion(target, () => true);
  if (!insertion) throw new Error('Missing actual Source insertion');
  runtime.editor.update(detach, { discrete: true });
  const beforeCommit = describeSelection(runtime.editor, names);
  const undoBefore = runtime.history.undoStack.length;
  const updates: Array<{
    dirtyElements: number;
    dirtyLeaves: number;
    tags: string[];
    selectionChanged: boolean;
  }> = [];
  const stop = runtime.editor.registerUpdateListener(
    ({ dirtyElements, dirtyLeaves, tags, editorState, prevEditorState }) => {
      updates.push({
        dirtyElements: dirtyElements.size,
        dirtyLeaves: dirtyLeaves.size,
        tags: [...tags].sort(),
        selectionChanged: !(
          editorState._selection?.is(prevEditorState._selection) ??
          prevEditorState._selection === null
        ),
      });
    }
  );
  let owned = false;
  let thrown: unknown;
  let result: boolean | Promise<boolean> | undefined;
  try {
    result = runtime.host.commit(insertion, GIF, FILE_ID, () => {
      owned = true;
    });
  } catch (error) {
    thrown = error;
  } finally {
    stop();
  }
  const afterCommit = describeSelection(runtime.editor, names);
  // The empty update leaves no undo entry: history ignores it.
  const undoEntriesAdded = runtime.history.undoStack.length - undoBefore;
  return {
    result,
    owned,
    thrown,
    beforeCommit,
    afterCommit,
    updates,
    undoEntriesAdded,
  };
}

test('Source: a detached NodeSelection capture inserts nothing yet reports the upload owned', () => {
  const runtime = mount();
  try {
    let target: BaseSelection | null = null;
    let imageKey = '';
    runtime.editor.update(
      () => {
        const image = $createImageNode({
          srcType: 'url',
          url: 'https://example.test/original.gif',
        });
        imageKey = image.getKey();
        $getRoot().append(
          $createParagraphNode().append($createTextNode('before')),
          $createParagraphNode().append(image),
          $createParagraphNode().append($createTextNode('after'))
        );
        const selection = $createNodeSelection();
        selection.add(imageKey);
        $setSelection(selection);
        target = runtime.host.captureTarget();
      },
      { discrete: true }
    );
    const names = new Map([[imageKey, 'image']]);
    const outcome = commitCaptured(runtime, target, names, () => {
      $getNodeByKey(imageKey)?.getParentOrThrow().remove();
    });
    expect({ ...outcome, root: rootTypes(runtime.editor) }).toEqual(
      RECORD_NODE
    );
  } finally {
    runtime.dispose();
  }
});

test('Source: a detached TableSelection capture inserts nothing yet reports the upload owned', () => {
  const runtime = mount();
  try {
    let target: BaseSelection | null = null;
    let tableKey = '';
    let anchorKey = '';
    let focusKey = '';
    runtime.editor.update(
      () => {
        const table = $createTableNode();
        const cells: TableCellNode[] = [];
        for (const texts of [
          ['A1', 'A2'],
          ['B1', 'B2'],
        ]) {
          const row = $createTableRowNode();
          const rowCells = texts.map((text) => $createTextCell(text));
          cells.push(...rowCells);
          row.append(...rowCells);
          table.append(row);
        }
        tableKey = table.getKey();
        $getRoot().append(
          $createParagraphNode().append($createTextNode('before')),
          table,
          $createParagraphNode().append($createTextNode('after'))
        );
        const [first, , , last] = cells;
        if (!first || !last) throw new Error('Missing table cells');
        const selection = $createTableSelection();
        anchorKey = first.getKey();
        focusKey = last.getKey();
        selection.set(tableKey, anchorKey, focusKey);
        $setSelection(selection);
        target = runtime.host.captureTarget();
      },
      { discrete: true }
    );
    const names = new Map([
      [tableKey, 'table'],
      [anchorKey, 'anchorCell'],
      [focusKey, 'focusCell'],
    ]);
    const outcome = commitCaptured(runtime, target, names, () => {
      $getNodeByKey(tableKey)?.remove();
    });
    expect({ ...outcome, root: rootTypes(runtime.editor) }).toEqual(
      RECORD_TABLE
    );
  } finally {
    runtime.dispose();
  }
});

// $insertNodesAndSplitList on a non-range selection attaches nothing and
// throws nothing, so the command "ran" and onInserted fires (a shared leak).
const RECORD_NODE = {
  result: true,
  owned: true,
  thrown: undefined,
  // Lexical keeps a node/table selection over removed keys: the live selection
  // is already the stale capture, and $setSelection(saved) leaves it unchanged.
  beforeCommit: { kind: 'node', keys: ['image'] },
  afterCommit: { kind: 'node', keys: ['image'] },
  // One committed update with nothing dirty and no tags: history ignores it,
  // and no selection change is published.
  updates: [
    { dirtyElements: 0, dirtyLeaves: 0, tags: [], selectionChanged: false },
  ],
  undoEntriesAdded: 0,
  root: [
    { type: 'paragraph', text: 'before', hasFile: false },
    { type: 'paragraph', text: 'after', hasFile: false },
  ],
};
const RECORD_TABLE = {
  result: true,
  owned: true,
  thrown: undefined,
  // Lexical keeps a node/table selection over removed keys: the live selection
  // is already the stale capture, and $setSelection(saved) leaves it unchanged.
  beforeCommit: {
    kind: 'table',
    table: 'table',
    anchor: 'anchorCell',
    focus: 'focusCell',
  },
  afterCommit: {
    kind: 'table',
    table: 'table',
    anchor: 'anchorCell',
    focus: 'focusCell',
  },
  // One committed update with nothing dirty and no tags: history ignores it,
  // and no selection change is published.
  updates: [
    { dirtyElements: 0, dirtyLeaves: 0, tags: [], selectionChanged: false },
  ],
  undoEntriesAdded: 0,
  root: [
    { type: 'paragraph', text: 'before', hasFile: false },
    { type: 'paragraph', text: 'after', hasFile: false },
  ],
};
