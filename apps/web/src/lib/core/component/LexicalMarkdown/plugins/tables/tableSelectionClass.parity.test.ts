/** @vitest-environment jsdom */
/**
 * Selected-table highlight parity. Source @lexical/table $syncTableSelectionState
 * (run on SELECTION_CHANGE_COMMAND) adds theme.tableSelection to the table and
 * theme.tableCellSelected to every cell while tableNode.isSelected(), and removes
 * both once it is not; a range between two cells of one table becomes a
 * TableSelection over those cells. Each case selects and then clears the way the
 * product does: the selection changes and SELECTION_CHANGE_COMMAND is dispatched.
 */
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import * as native from '@core/document-session/wasm/document_session_wasm.js';
import { registerRichText } from '@lexical/rich-text';
import { $isTableNode } from '@lexical/table';
import { ABI_MAJOR } from '@macro-inc/collaboration/session/abi.generated';
import { SupportedNodeTypes } from '@macro-inc/lexical-core';
import {
  createBuiltinRegistry,
  mountLocalSessionView,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { NOOP_SPAN } from '@macro-inc/observability';
import {
  $createNodeSelection,
  $createRangeSelection,
  $getRoot,
  $isElementNode,
  $isTextNode,
  $setSelection,
  createEditor,
  type LexicalEditor,
  type LexicalNode,
  SELECTION_CHANGE_COMMAND,
} from 'lexical';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { theme } from '../../theme';
import { tablePlugin } from './tablePlugin';

const previousLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
beforeAll(() => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: locks,
  });
  native.initSync({
    module: readFileSync(
      resolve(
        import.meta.dirname,
        '../../../../document-session/wasm/document_session_wasm_bg.wasm'
      )
    ),
  });
});
afterAll(() => {
  if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks);
  else Reflect.deleteProperty(navigator, 'locks');
});

const text = (value: string) => ({
  type: 'text',
  version: 1,
  text: value,
  format: 0,
  detail: 0,
  mode: 'normal',
  style: '',
});
const paragraph = (value: string) => ({
  type: 'paragraph',
  version: 1,
  direction: null,
  format: '',
  indent: 0,
  textFormat: 0,
  textStyle: '',
  children: [text(value)],
});
const cell = (value: string) => ({
  type: 'tablecell',
  version: 1,
  direction: null,
  format: '',
  indent: 0,
  headerState: 0,
  colSpan: 1,
  rowSpan: 1,
  backgroundColor: null,
  children: [paragraph(value)],
});
const STATE = {
  root: {
    type: 'root',
    version: 1,
    direction: null,
    format: '',
    indent: 0,
    children: [
      paragraph('before'),
      {
        type: 'table',
        version: 1,
        direction: null,
        format: '',
        indent: 0,
        colWidths: [120, 120],
        children: [
          ['a1', 'b1'],
          ['a2', 'b2'],
        ].map((row) => ({
          type: 'tablerow',
          version: 1,
          direction: null,
          format: '',
          indent: 0,
          children: row.map(cell),
        })),
      },
      paragraph('after'),
    ],
  },
};

/** The table's classes and each cell's classes and highlight attributes, in order. */
function paint(root: HTMLElement) {
  const table = root.querySelector('table');
  return {
    table: [...(table?.classList ?? [])].sort().join(' '),
    cells: [...root.querySelectorAll('td,th')].map((element) =>
      [
        [...element.classList].sort().join(' '),
        ...['aria-selected', 'data-lexical-table-selected', 'style']
          .filter((name) => element.hasAttribute(name))
          .map((name) => `${name}=${element.getAttribute(name)}`),
      ].join(' | ')
    ),
  };
}

// ---- Source ------------------------------------------------------------------

function $textOf(value: string): LexicalNode {
  const stack: LexicalNode[] = [$getRoot()];
  while (stack.length) {
    const node = stack.shift();
    if ($isTextNode(node) && node.getTextContent() === value) return node;
    if ($isElementNode(node)) stack.unshift(...node.getChildren());
  }
  throw new Error('Missing text ' + value);
}

function $range(
  from: string,
  fromOffset: number,
  to: string,
  toOffset: number
) {
  const selection = $createRangeSelection();
  selection.anchor.set($textOf(from).getKey(), fromOffset, 'text');
  selection.focus.set($textOf(to).getKey(), toOffset, 'text');
  $setSelection(selection);
}

/** A range between two root element points (child offsets of the root). */
function $rootRange(anchor: number, focus: number) {
  const selection = $createRangeSelection();
  const key = $getRoot().getKey();
  selection.anchor.set(key, anchor, 'element');
  selection.focus.set(key, focus, 'element');
  $setSelection(selection);
}

function editorWith(root: HTMLElement) {
  const editor = createEditor({
    namespace: 'table-selection-class-source',
    nodes: [...SupportedNodeTypes],
    theme,
    onError(error) {
      throw error;
    },
  });
  const release = [
    tablePlugin({
      hasCellMerge: true,
      hasCellBackgroundColor: true,
      hasTabHandler: true,
      hasHorizontalScroll: true,
    })(editor),
    registerRichText(editor),
  ];
  editor.setRootElement(root);
  editor.setEditorState(editor.parseEditorState(JSON.stringify(STATE)));
  return { editor, release };
}

/** The product path: change the selection, then dispatch SELECTION_CHANGE. */
function select(editor: LexicalEditor, $select: () => void) {
  editor.update($select, { discrete: true });
  editor.dispatchCommand(SELECTION_CHANGE_COMMAND, undefined);
}

async function sourceSteps($select: () => void) {
  const root = document.createElement('div');
  document.body.append(root);
  const { editor, release } = editorWith(root);
  try {
    const before = paint(root);
    select(editor, $select);
    const selected = paint(root);
    select(editor, () => $setSelection(null));
    await new Promise<void>((done) => setTimeout(done, 0));
    return { before, selected, cleared: paint(root) };
  } finally {
    editor.setRootElement(null);
    for (const stop of release.reverse()) stop();
    root.remove();
  }
}

// ---- Native ------------------------------------------------------------------

type Runtime = ReturnType<typeof mountLocalSessionView>;
type NativeSelection = Parameters<Runtime['port']['selectionFromView']>[0];
type Mirror = Runtime['view']['mirror'];

function textKey(mirror: Mirror, value: string) {
  const node = [...mirror.values()].find(
    (candidate) => candidate.kind === 'text' && candidate.text === value
  );
  if (!node) throw new Error('Missing native text ' + value);
  return node.key;
}

const nativeRootRange =
  (anchor: number, focus: number) =>
  (mirror: Mirror): NativeSelection => {
    const root = [...mirror.values()].find((node) => node.kind === 'root');
    if (!root) throw new Error('Missing native root');
    return {
      kind: 'range',
      anchor: { key: root.key, offset: anchor, type: 'element' },
      focus: { key: root.key, offset: focus, type: 'element' },
    };
  };

const nativeRange =
  (from: string, fromOffset: number, to: string, toOffset: number) =>
  (mirror: Mirror): NativeSelection => ({
    kind: 'range',
    anchor: { key: textKey(mirror, from), offset: fromOffset, type: 'text' },
    focus: { key: textKey(mirror, to), offset: toOffset, type: 'text' },
  });

async function nativeSteps(selection: (mirror: Mirror) => NativeSelection) {
  const root = document.createElement('div');
  document.body.append(root);
  const runtime = mountLocalSessionView(
    root,
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: 'table-selection-class-native',
      theme,
      editable: true,
      preset: 'rich',
      parentSpan: NOOP_SPAN,
      onError(error) {
        throw error;
      },
    },
    {
      viewEngine: 1,
      viewOs: 0,
      nativeCommands: native,
      create: (config, now, wall) =>
        native.EditorSession.createMacroWithNamespace(
          ABI_MAJOR,
          config,
          now,
          wall,
          'table-selection-class-native'
        ),
    }
  );
  try {
    runtime.port.setState(JSON.stringify(STATE));
    const before = paint(root);
    // Change metadata dispatches the model SELECTION_CHANGE, as the view's DOM
    // selectionchange path does; the bare form only sets the selection.
    runtime.port.selectionFromView(selection(runtime.view.mirror), {});
    const selected = paint(root);
    runtime.port.selectionFromView({ kind: 'none' }, {});
    return { before, selected, cleared: paint(root) };
  } finally {
    await runtime.close();
    root.remove();
  }
}

// ---- Cases -------------------------------------------------------------------

const CASES: Array<{
  name: string;
  source: () => void;
  native: (mirror: Mirror) => NativeSelection;
}> = [
  {
    name: 'node selection of the table',
    source: () => {
      const selection = $createNodeSelection();
      const table = $getRoot().getChildren().find($isTableNode);
      if (!table) throw new Error('Missing table');
      selection.add(table.getKey());
      $setSelection(selection);
    },
    native: (mirror) => {
      const table = [...mirror.values()].find((node) => node.type === 'table');
      if (!table) throw new Error('Missing native table');
      return { kind: 'node', keys: [table.key] };
    },
  },
  {
    name: 'range from the paragraph before to the paragraph after',
    source: () => $range('before', 2, 'after', 2),
    native: nativeRange('before', 2, 'after', 2),
  },
  {
    name: 'range from before the table into a cell',
    source: () => $range('before', 2, 'a2', 1),
    native: nativeRange('before', 2, 'a2', 1),
  },
  {
    name: 'range from a cell to after the table',
    source: () => $range('b1', 1, 'after', 2),
    native: nativeRange('b1', 1, 'after', 2),
  },
  {
    name: 'range inside one cell',
    source: () => $range('a1', 0, 'a1', 2),
    native: nativeRange('a1', 0, 'a1', 2),
  },
  {
    name: 'collapsed caret in a cell',
    source: () => $range('a1', 1, 'a1', 1),
    native: nativeRange('a1', 1, 'a1', 1),
  },
  {
    name: 'range from one cell to another cell of the table',
    source: () => $range('a1', 1, 'b2', 1),
    native: nativeRange('a1', 1, 'b2', 1),
  },
  {
    name: 'range between two cells of one row',
    source: () => $range('a1', 1, 'b1', 1),
    native: nativeRange('a1', 1, 'b1', 1),
  },
  // The table is the root's child 1: points exactly at its element edges.
  {
    name: 'root element points around the table (root[1]..root[2])',
    source: () => $rootRange(1, 2),
    native: nativeRootRange(1, 2),
  },
  {
    name: 'backward root element points around the table (root[2]..root[1])',
    source: () => $rootRange(2, 1),
    native: nativeRootRange(2, 1),
  },
  {
    name: 'root element points before the table (root[0]..root[1])',
    source: () => $rootRange(0, 1),
    native: nativeRootRange(0, 1),
  },
  {
    name: 'root element points after the table (root[2]..root[3])',
    source: () => $rootRange(2, 3),
    native: nativeRootRange(2, 3),
  },
  {
    name: 'select all',
    source: () => $getRoot().select(0, $getRoot().getChildrenSize()),
    native: (mirror) => {
      const root = [...mirror.values()].find((node) => node.kind === 'root');
      if (!root) throw new Error('Missing native root');
      return {
        kind: 'range',
        anchor: { key: root.key, offset: 0, type: 'element' },
        focus: {
          key: root.key,
          offset: root.children.length,
          type: 'element',
        },
      };
    },
  },
];

for (const { name, source, native: nativeSelection } of CASES) {
  test(`${name}: native paints and clears the table highlight as Source does`, async () => {
    const expected = await sourceSteps(source);
    expect(await nativeSteps(nativeSelection)).toEqual(expected);
  });
}
