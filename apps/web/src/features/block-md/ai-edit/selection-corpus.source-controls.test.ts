import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { registerList } from '@lexical/list';
import { $convertFromMarkdownString } from '@lexical/markdown';
import { registerRichText } from '@lexical/rich-text';
import {
  $updateAllNodeIds,
  ALL_TRANSFORMERS,
  type NodeIdMappings,
  nodeIdPlugin,
} from '@macro-inc/lexical-core';
import {
  NodeReplacements,
  SupportedNodeTypes,
} from '@macro-inc/lexical-core/node-list';
import { createEditor } from 'lexical';
import { expect, test, vi } from 'vitest';

// Seed for the native `group-c.selected-block-ids` query: the document the live
// OFF popup capture used, imported by the app's own Markdown transformers.
// Expected ids are node paths transcribed from that capture (real MarkdownPopup
// resolveSelectedNodeIds over its stored selection); this test only produces the
// seed. Regenerate with UPDATE_NATIVE_CORPUS=1.

vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

const FIXTURE = resolve(
  import.meta.dirname,
  '../../../../../../crates/client/lexical/macro_document_model/src/plugins_group_c/ai_ops/corpus/selection.json'
);

const MARKDOWN =
  'Alpha beta gamma\n\nSecond line\n\n| h1 | h2 | h3 |\n| --- | --- | --- |\n| c1 | c2 | c3 |\n| d1 | d2 | d3 |\n\nTail para';

const EVIDENCE =
  'w-ai-generate/source-controls/ai-table-20261112T1901/ai-table.json sha256 0504e75ae6d4a2ebd713fe01f169c00bdab4a332630190e3da3bf6a5e9bd789d';

/** Paths are child indices from the root; the header row is table row 0. */
const CASES = [
  {
    name: 'cell range c1 to c2 (one row)',
    selection: { kind: 'table', anchor: [2, 1, 0], focus: [2, 1, 1] },
    expected: [[2], [2, 1], [2, 1, 0], [2, 1, 0, 0], [2, 1, 1], [2, 1, 1, 0]],
  },
  {
    name: 'cell range c1 to d2 (2x2)',
    selection: { kind: 'table', anchor: [2, 1, 0], focus: [2, 2, 1] },
    expected: [
      [2],
      [2, 1],
      [2, 1, 0],
      [2, 1, 0, 0],
      [2, 1, 1],
      [2, 1, 1, 0],
      [2, 2],
      [2, 2, 0],
      [2, 2, 0, 0],
      [2, 2, 1],
      [2, 2, 1, 0],
    ],
  },
  {
    name: 'cell range d3 to c1 (backward 2x3) keeps document order',
    selection: { kind: 'table', anchor: [2, 2, 2], focus: [2, 1, 0] },
    expected: [
      [2],
      [2, 1],
      [2, 1, 0],
      [2, 1, 0, 0],
      [2, 1, 1],
      [2, 1, 1, 0],
      [2, 1, 2],
      [2, 1, 2, 0],
      [2, 2],
      [2, 2, 0],
      [2, 2, 0, 0],
      [2, 2, 1],
      [2, 2, 1, 0],
      [2, 2, 2],
      [2, 2, 2, 0],
    ],
  },
  {
    name: 'text inside one cell resolves to the cell paragraph',
    selection: {
      kind: 'range',
      anchor: { path: [2, 1, 1, 0, 0], offset: 0 },
      focus: { path: [2, 1, 1, 0, 0], offset: 2 },
    },
    expected: [[2, 1, 1, 0]],
  },
  {
    name: 'range across two paragraphs',
    selection: {
      kind: 'range',
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [1, 0], offset: 6 },
    },
    expected: [[0], [1]],
  },
];

test('the native selection corpus seed matches the app import', () => {
  const editor = createEditor({
    namespace: 'ai-edit-selection-corpus',
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
    onError: (error) => {
      throw error;
    },
  });
  const mappings: NodeIdMappings = {
    idToNodeKeyMap: new Map(),
    nodeKeyToIdMap: new Map(),
  };
  registerRichText(editor);
  registerList(editor);
  nodeIdPlugin({ nodes: SupportedNodeTypes, mappings })(editor);
  editor.update(
    () => {
      $convertFromMarkdownString(MARKDOWN, ALL_TRANSFORMERS);
      $updateAllNodeIds(mappings);
    },
    { discrete: true }
  );
  const seed = editor.getEditorState().toJSON();
  const table = seed.root.children[2] as { type: string };
  expect(table.type).toBe('table');
  const json = `${JSON.stringify({ evidence: EVIDENCE, seed, cases: CASES }, null, 2)}\n`;
  if (process.env.UPDATE_NATIVE_CORPUS === '1') writeFileSync(FIXTURE, json);
  expect(existsSync(FIXTURE)).toBe(true);
  // Seed ids are random per session; compare structure, not id values.
  const strip = (s: string) => s.replace(/"id": "[^"]*"/g, '"id": ""');
  expect(strip(readFileSync(FIXTURE, 'utf8'))).toBe(strip(json));
});
