/** @vitest-environment jsdom */
/**
 * Source oracle for a GIF commit whose captured NodeSelection or TableSelection
 * was detached before the upload finished. lexical-gif.ts rechecks attachment
 * only for a RangeSelection; these record what Source does for the other kinds.
 */
import {
  $createTableNode,
  $createTableRowNode,
  $createTableSelection,
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
  const dispose = () => {
    plugins.cleanup();
    editor.setRootElement(null);
    element.remove();
  };
  return { editor, host, dispose };
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

function commitCaptured(
  runtime: ReturnType<typeof mount>,
  target: BaseSelection | null,
  detach: () => void
) {
  const insertion = runtime.host.prepareInsertion(target, () => true);
  if (!insertion) throw new Error('Missing actual Source insertion');
  runtime.editor.update(detach, { discrete: true });
  let owned = false;
  let thrown: unknown;
  let result: boolean | undefined;
  try {
    result = runtime.host.commit(insertion, GIF, FILE_ID, () => {
      owned = true;
    });
  } catch (error) {
    thrown = error;
  }
  const selection = runtime.editor
    .getEditorState()
    .read(() => $getSelection()?.constructor.name ?? 'none');
  return { result, owned, thrown, selection };
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
    const outcome = commitCaptured(runtime, target, () => {
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
        selection.set(tableKey, first.getKey(), last.getKey());
        $setSelection(selection);
        target = runtime.host.captureTarget();
      },
      { discrete: true }
    );
    const outcome = commitCaptured(runtime, target, () => {
      $getNodeByKey(tableKey)?.remove();
    });
    expect({ ...outcome, root: rootTypes(runtime.editor) }).toEqual(
      RECORD_TABLE
    );
  } finally {
    runtime.dispose();
  }
});

// $insertNodesAndSplitList on a selection whose nodes are gone attaches nothing
// and throws nothing, so the command "ran" and onInserted fires.
const RECORD_NODE = {
  result: true,
  owned: true,
  thrown: undefined,
  selection: 'NodeSelection',
  root: [
    { type: 'paragraph', text: 'before', hasFile: false },
    { type: 'paragraph', text: 'after', hasFile: false },
  ],
};
const RECORD_TABLE = {
  result: true,
  owned: true,
  thrown: undefined,
  selection: 'TableSelection',
  root: [
    { type: 'paragraph', text: 'before', hasFile: false },
    { type: 'paragraph', text: 'after', hasFile: false },
  ],
};
