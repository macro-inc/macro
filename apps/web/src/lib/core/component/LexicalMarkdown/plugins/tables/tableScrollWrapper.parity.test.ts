/** @vitest-environment jsdom */
/**
 * The markdown editor registers its tables with hasHorizontalScroll: true
 * (editing/registerMarkdownEditing.ts), so Source TableNode.createDOM wraps
 * each table in a div carrying theme.tableScrollableWrapper. Both engines
 * render the same 3x3 table with the Macro theme; the table subtree shape
 * (tags and classes, outermost first) must match.
 */
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import * as native from '@core/document-session/wasm/document_session_wasm.js';
import { registerRichText } from '@lexical/rich-text';
import {
  ABI_MAJOR,
  CommandCode,
} from '@macro-inc/collaboration/session/abi.generated';
import { SupportedNodeTypes } from '@macro-inc/lexical-core';
import {
  createBuiltinRegistry,
  getTableObserverFromTableElement,
  mountLocalSessionView,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { NOOP_SPAN } from '@macro-inc/observability';
import {
  $createNodeSelection,
  $getRoot,
  $setSelection,
  createEditor,
  type ElementFormatType,
  FORMAT_ELEMENT_COMMAND,
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

const cell = (text: string) => ({
  type: 'tablecell',
  version: 1,
  direction: null,
  format: '',
  indent: 0,
  headerState: 0,
  colSpan: 1,
  rowSpan: 1,
  backgroundColor: null,
  children: [
    {
      type: 'paragraph',
      version: 1,
      direction: null,
      format: '',
      indent: 0,
      children: [{ type: 'text', version: 1, text }],
    },
  ],
});
const stateWith = (frozen: number | null, format = '') => ({
  root: {
    type: 'root',
    version: 1,
    direction: null,
    format: '',
    indent: 0,
    children: [
      {
        type: 'table',
        version: 1,
        direction: null,
        indent: 0,
        format,
        colWidths: [120, 120, 120],
        ...(frozen === null
          ? {}
          : { frozenColumnCount: frozen, frozenRowCount: frozen }),
        children: [0, 1, 2].map((row) => ({
          type: 'tablerow',
          version: 1,
          direction: null,
          format: '',
          indent: 0,
          children: [0, 1, 2].map((column) => cell(`${row},${column}`)),
        })),
      },
    ],
  },
});
const STATE = stateWith(null);

/** Tag and sorted classes from the root's first child down to the table. */
function shape(root: HTMLElement) {
  const path: string[] = [];
  let element = root.firstElementChild;
  while (element) {
    const frozen = ['data-lexical-frozen-column', 'data-lexical-frozen-row']
      .filter((name) => element?.getAttribute(name) === 'true')
      .map((name) => `[${name}]`)
      .join('');
    const style = element.getAttribute('style');
    const dir = element.getAttribute('dir');
    path.push(
      `${element.tagName.toLowerCase()}.${[...element.classList].sort().join('.')}${frozen}${style ? `{${style}}` : ''}${dir ? `<${dir}>` : ''}`
    );
    if (element.tagName === 'TABLE') break;
    element = element.firstElementChild;
  }
  return path;
}

function sourceShape(state: object = STATE) {
  const editor = createEditor({
    namespace: 'table-scroll-source',
    nodes: [...SupportedNodeTypes],
    theme,
    onError(error) {
      throw error;
    },
  });
  const root = document.createElement('div');
  document.body.append(root);
  const release = tablePlugin({
    hasCellMerge: true,
    hasCellBackgroundColor: true,
    hasTabHandler: true,
    hasHorizontalScroll: true,
  })(editor);
  editor.setRootElement(root);
  try {
    editor.setEditorState(editor.parseEditorState(JSON.stringify(state)));
    editor.update(() => $getRoot().getChildrenSize(), { discrete: true });
    return shape(root);
  } finally {
    release();
    editor.setRootElement(null);
    root.remove();
  }
}

async function nativeShape(state: object = STATE) {
  const root = document.createElement('div');
  document.body.append(root);
  const runtime = mountLocalSessionView(
    root,
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: 'table-scroll-native',
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
          'table-scroll-native'
        ),
    }
  );
  try {
    runtime.port.setState(JSON.stringify(state));
    return shape(root);
  } finally {
    await runtime.close();
    root.remove();
  }
}

test('the Source markdown table is wrapped in the scrollable wrapper', () => {
  expect(sourceShape()).toEqual([
    'div.first:mt-1.5.md-table-scrollable-wrapper<auto>',
    'table.md-table',
  ]);
});

test('the native markdown table has the same scrollable wrapper as Source', async () => {
  expect(await nativeShape()).toEqual(sourceShape());
});

test('frozen column and row counts mark the wrapper and table as Source does', async () => {
  const frozen = stateWith(1);
  expect(sourceShape(frozen)).toEqual([
    'div.first:mt-1.5.md-table-frozen-column.md-table-frozen-row.md-table-scrollable-wrapper<auto>',
    'table.md-table[data-lexical-frozen-column][data-lexical-frozen-row]',
  ]);
  expect(await nativeShape(frozen)).toEqual(sourceShape(frozen));
});

for (const format of ['center', 'right', 'left', '']) {
  test(`table format '${format}' aligns the table element as Source does`, async () => {
    const state = stateWith(null, format);
    expect(await nativeShape(state)).toEqual(sourceShape(state));
  });
}

const FORMATS: ElementFormatType[] = ['center', 'right', 'left'];

/** Source: FORMAT_ELEMENT_COMMAND over a NodeSelection of the table, step by step. */
async function sourceFormatSteps() {
  const editor = createEditor({
    namespace: 'table-scroll-source-format',
    nodes: [...SupportedNodeTypes],
    theme,
    onError(error) {
      throw error;
    },
  });
  const root = document.createElement('div');
  document.body.append(root);
  const release = tablePlugin({
    hasCellMerge: true,
    hasCellBackgroundColor: true,
    hasTabHandler: true,
    hasHorizontalScroll: true,
  })(editor);
  const stopRichText = registerRichText(editor);
  editor.setRootElement(root);
  try {
    editor.setEditorState(editor.parseEditorState(JSON.stringify(STATE)));
    const steps: string[][] = [];
    for (const format of FORMATS) {
      editor.update(
        () => {
          const table = $getRoot().getFirstChildOrThrow();
          const selection = $createNodeSelection();
          selection.add(table.getKey());
          $setSelection(selection);
        },
        { discrete: true }
      );
      editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, format);
      // Clear as the product does, so the selected-table highlight comes off
      // (tableSelectionClass.parity.test.ts covers the highlight itself).
      editor.update(() => $setSelection(null), { discrete: true });
      editor.dispatchCommand(SELECTION_CHANGE_COMMAND, undefined);
      steps.push(shape(root));
    }
    // Let the table observer's deferred work run before teardown.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    return steps;
  } finally {
    editor.setRootElement(null);
    stopRichText();
    release();
    root.remove();
  }
}

async function nativeFormatSteps() {
  const root = document.createElement('div');
  document.body.append(root);
  const runtime = mountLocalSessionView(
    root,
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: 'table-scroll-native-format',
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
          'table-scroll-native-format'
        ),
    }
  );
  try {
    runtime.port.setState(JSON.stringify(STATE));
    const table = [...runtime.view.mirror.values()].find(
      (node) => node.type === 'table'
    );
    if (!table) throw new Error('Missing native table');
    const steps: string[][] = [];
    for (const format of FORMATS) {
      runtime.port.selectionFromView({ kind: 'node', keys: [table.key] });
      runtime.port.command(
        CommandCode.FormatElement,
        ['', 'left', 'center', 'right'].indexOf(format)
      );
      runtime.port.selectionFromView({ kind: 'none' }, {});
      steps.push(shape(root));
    }
    return steps;
  } finally {
    await runtime.close();
    root.remove();
  }
}

test('formatting the table center, right, then left updates it as Source does', async () => {
  expect(await nativeFormatSteps()).toEqual(await sourceFormatSteps());
});

// Guard: the wrapper is the table node's DOM, and the renderer keeps one table
// observer, compared against the inner table, across table property commits.
test('a table property change keeps the native table observer', async () => {
  const root = document.createElement('div');
  document.body.append(root);
  const runtime = mountLocalSessionView(
    root,
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: 'table-scroll-native-observer',
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
          'table-scroll-native-observer'
        ),
    }
  );
  try {
    runtime.port.setState(JSON.stringify(STATE));
    const table = [...runtime.view.mirror.values()].find(
      (node) => node.type === 'table'
    );
    const element = root.querySelector('table');
    if (!table || !element) throw new Error('Missing native table');
    const before = getTableObserverFromTableElement(element);
    expect(before).toBeDefined();
    runtime.port.selectionFromView({ kind: 'node', keys: [table.key] });
    runtime.port.command(CommandCode.FormatElement, 3);
    expect(root.querySelector('table')).toBe(element);
    expect(getTableObserverFromTableElement(element)).toBe(before);
  } finally {
    await runtime.close();
    root.remove();
  }
});
