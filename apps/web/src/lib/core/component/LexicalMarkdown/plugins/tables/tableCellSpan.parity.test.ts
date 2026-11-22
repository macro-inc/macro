/** @vitest-environment jsdom */
/**
 * Table cell span attributes. Source @lexical/table TableCellNode.createDOM sets
 * colSpan/rowSpan only above 1 (and re-creates the cell when a span changes), so
 * a default cell carries neither attribute. Both engines render the same table
 * with the Macro theme; each cell's span attributes must match.
 */
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import * as native from '@core/document-session/wasm/document_session_wasm.js';
import { ABI_MAJOR } from '@macro-inc/collaboration/session/abi.generated';
import { SupportedNodeTypes } from '@macro-inc/lexical-core';
import {
  createBuiltinRegistry,
  mountLocalSessionView,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { NOOP_SPAN } from '@macro-inc/observability';
import { createEditor } from 'lexical';
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

const cell = (text: string, colSpan = 1, rowSpan = 1) => ({
  type: 'tablecell',
  version: 1,
  direction: null,
  format: '',
  indent: 0,
  headerState: 0,
  colSpan,
  rowSpan,
  backgroundColor: null,
  children: [
    {
      type: 'paragraph',
      version: 1,
      direction: null,
      format: '',
      indent: 0,
      textFormat: 0,
      textStyle: '',
      children: [
        {
          type: 'text',
          version: 1,
          text,
          format: 0,
          detail: 0,
          mode: 'normal',
          style: '',
        },
      ],
    },
  ],
});
const row = (cells: ReturnType<typeof cell>[]) => ({
  type: 'tablerow',
  version: 1,
  direction: null,
  format: '',
  indent: 0,
  children: cells,
});
// A 3x3 grid: a1 spans two columns, a3 spans two rows; the rest are default.
const STATE = {
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
        format: '',
        indent: 0,
        colWidths: [120, 120, 120],
        children: [
          row([cell('a1', 2), cell('c1')]),
          row([cell('a2'), cell('b2'), cell('c2', 1, 2)]),
          row([cell('a3'), cell('b3')]),
        ],
      },
    ],
  },
};

/** Each cell's text with its colspan/rowspan attributes, in document order. */
function spans(root: HTMLElement) {
  return [...root.querySelectorAll('td,th')].map((element) => ({
    text: element.textContent,
    colspan: element.getAttribute('colspan'),
    rowspan: element.getAttribute('rowspan'),
  }));
}

function sourceSpans() {
  const editor = createEditor({
    namespace: 'table-cell-span-source',
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
    editor.setEditorState(editor.parseEditorState(JSON.stringify(STATE)));
    return spans(root);
  } finally {
    editor.setRootElement(null);
    release();
    root.remove();
  }
}

async function nativeSpans() {
  const root = document.createElement('div');
  document.body.append(root);
  const runtime = mountLocalSessionView(
    root,
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: 'table-cell-span-native',
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
          'table-cell-span-native'
        ),
    }
  );
  try {
    runtime.port.setState(JSON.stringify(STATE));
    return spans(root);
  } finally {
    await runtime.close();
    root.remove();
  }
}

test('Source writes span attributes only above 1', () => {
  expect(sourceSpans()).toEqual([
    { text: 'a1', colspan: '2', rowspan: null },
    { text: 'c1', colspan: null, rowspan: null },
    { text: 'a2', colspan: null, rowspan: null },
    { text: 'b2', colspan: null, rowspan: null },
    { text: 'c2', colspan: null, rowspan: '2' },
    { text: 'a3', colspan: null, rowspan: null },
    { text: 'b3', colspan: null, rowspan: null },
  ]);
});

test('native table cells carry the same span attributes as Source', async () => {
  expect(await nativeSpans()).toEqual(sourceSpans());
});
