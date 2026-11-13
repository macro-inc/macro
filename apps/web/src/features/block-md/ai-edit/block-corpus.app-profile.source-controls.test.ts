import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DocumentOp } from '@ai-ops/editor';
import { documentMetadataPlugin } from '@core/component/LexicalMarkdown/plugins/document-metadata';
import { tableCellResizerPlugin } from '@core/component/LexicalMarkdown/plugins/tables/tableCellResizerPlugin';
import { trailingParagraphPlugin } from '@core/component/LexicalMarkdown/plugins/trailing-paragraph';
import { registerCodeHighlighting } from '@lexical/code';
import { registerList } from '@lexical/list';
import { registerRichText } from '@lexical/rich-text';
import {
  $updateAllNodeIds,
  type NodeIdMappings,
  nodeIdPlugin,
} from '@macro-inc/lexical-core';
import {
  NodeReplacements,
  SupportedNodeTypes,
} from '@macro-inc/lexical-core/node-list';
import {
  $getRoot,
  $isElementNode,
  createEditor,
  type LexicalNode,
  type SerializedEditorState,
} from 'lexical';
import { expect, test, vi } from 'vitest';
import { applyAiOps } from './applyAiOps';

// Source control for the native block-op replay: the headless corpus oracle
// (ai-editing-worker `setup`) has none of the app's normalizing plugins. This
// replays every corpus case, loading each seed with every node dirty, through the real `applyAiOps`, with the three app plugins that write state on
// transform or update (registerMarkdownEditing: documentMetadataPlugin,
// tableCellResizerPlugin, trailingParagraphPlugin) plus codePlugin's
// registerCodeHighlighting, and records how each
// resulting state differs from the oracle. Nothing here is native.

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

const CORPUS = resolve(
  import.meta.dirname,
  '../../../../../../crates/client/lexical/macro_document_model/src/plugins_group_c/ai_ops/corpus/blocks.json'
);

type Entry = {
  name: string;
  seed: SerializedEditorState;
  ops: DocumentOp[];
  state: SerializedEditorState;
  failedAt: number | null;
  refs: string[];
};

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Leaf paths where `oracle` and `app` differ, child arrays compared by index. */
function diff(oracle: Json, app: Json, path: string, out: string[]): void {
  if (Array.isArray(oracle) && Array.isArray(app)) {
    if (oracle.length !== app.length)
      out.push(`${path}: length ${oracle.length} -> ${app.length}`);
    for (let i = 0; i < Math.min(oracle.length, app.length); i++)
      diff(oracle[i] ?? null, app[i] ?? null, `${path}[${i}]`, out);
    return;
  }
  if (
    oracle !== null &&
    app !== null &&
    typeof oracle === 'object' &&
    typeof app === 'object' &&
    !Array.isArray(oracle) &&
    !Array.isArray(app)
  ) {
    for (const key of new Set([...Object.keys(oracle), ...Object.keys(app)])) {
      if (!(key in app)) out.push(`${path}.${key}: oracle-only`);
      else if (!(key in oracle))
        out.push(`${path}.${key}: app-only ${JSON.stringify(app[key])}`);
      else diff(oracle[key] ?? null, app[key] ?? null, `${path}.${key}`, out);
    }
    return;
  }
  if (JSON.stringify(oracle) !== JSON.stringify(app))
    out.push(`${path}: ${JSON.stringify(oracle)} -> ${JSON.stringify(app)}`);
}

/** Serialized as stored: keys whose value is undefined are dropped. */
function stored(state: SerializedEditorState): SerializedEditorState {
  return JSON.parse(JSON.stringify(state));
}

/** The corpus id normalization: seed ids and refs kept, other ids `<newN>` in order. */
function normalize(state: SerializedEditorState, entry: Entry): Json {
  const keep = new Set<string>(entry.refs);
  const collect = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object')
      for (const [key, child] of Object.entries(value)) {
        if (key === '$' && child && typeof child === 'object') {
          const id = (child as { id?: unknown }).id;
          if (typeof id === 'string') keep.add(id);
        } else collect(child);
      }
  };
  collect(entry.seed);
  const names = new Map<string, string>();
  let minted = 0;
  const rename = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rename);
    if (!value || typeof value !== 'object') return value;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === '$' && child && typeof child === 'object') {
        const node = { ...(child as Record<string, unknown>) };
        if (typeof node.id === 'string' && !keep.has(node.id)) {
          let name = names.get(node.id);
          if (name === undefined) {
            name = `<new${minted++}>`;
            names.set(node.id, name);
          }
          node.id = name;
        }
        out[key] = node;
      } else out[key] = rename(child);
    }
    return out;
  };
  return rename(state) as Json;
}

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

async function replay(entry: Entry) {
  const editor = createEditor({
    namespace: 'ai-edit-app-profile',
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
    onError: (error) => {
      throw error;
    },
  });
  const mappings: NodeIdMappings = {
    idToNodeKeyMap: new Map(),
    nodeKeyToIdMap: new Map(),
  };
  editor.setRootElement(document.createElement('div'));
  registerRichText(editor);
  registerList(editor);
  registerCodeHighlighting(editor);
  nodeIdPlugin({ nodes: SupportedNodeTypes, mappings })(editor);
  documentMetadataPlugin({})(editor);
  tableCellResizerPlugin()(editor);
  trailingParagraphPlugin()(editor);
  editor.setEditorState(editor.parseEditorState(entry.seed));
  // A loaded document's nodes are all new to the editor, so node transforms
  // run on every one of them; marking each writable reproduces that here.
  editor.update(
    () => {
      const touch = (node: LexicalNode) => {
        node.getWritable();
        if ($isElementNode(node)) node.getChildren().forEach(touch);
      };
      touch($getRoot());
      $updateAllNodeIds(mappings);
    },
    { discrete: true }
  );
  await settle();
  const loaded = normalize(stored(editor.getEditorState().toJSON()), entry);
  let failedAt: number | null = null;
  try {
    applyAiOps(editor, mappings, entry.ops);
  } catch {
    // applyAiOps stops at the first failure without saying where; count applied ops below.
    failedAt = -1;
  }
  await settle();
  const applied = normalize(stored(editor.getEditorState().toJSON()), entry);
  const load: string[] = [];
  diff(entry.seed as unknown as Json, loaded, '', load);
  const apply: string[] = [];
  diff(entry.state as unknown as Json, applied, '', apply);
  return {
    name: entry.name,
    oracleFailedAt: entry.failedAt,
    appThrew: failedAt !== null,
    load,
    apply,
  };
}

test('records how the app plugin profile differs from the block corpus oracle', async () => {
  const corpus = JSON.parse(readFileSync(CORPUS, 'utf8')) as Entry[];
  const rows = [];
  for (const entry of corpus) rows.push(await replay(entry));
  const out = process.env.AI_EDIT_APP_PROFILE_OUT;
  if (out) writeFileSync(out, `${JSON.stringify(rows, null, 2)}\n`);
  for (const row of rows)
    console.log(
      `${row.name}\n  load:  ${row.load.join('; ') || 'same'}\n  apply: ${row.apply.join('; ') || 'same'}`
    );
  expect(rows).toHaveLength(corpus.length);
  // Failure points agree: the app profile changes no op outcome.
  for (const row of rows)
    expect(row.appThrew).toBe(row.oracleFailedAt !== null);
  // documentMetadataPlugin stamps every loaded and edited root.
  const metadata = '.root.$.documentMetadata: app-only {"version":10}';
  for (const row of rows) {
    expect(row.load).toEqual([metadata]);
    expect(row.apply).toContain(metadata);
  }
  // trailingParagraphPlugin and tableCellResizerPlugin add the rest.
  const extra = Object.fromEntries(
    rows
      .map(
        (row) => [row.name, row.apply.filter((d) => d !== metadata)] as const
      )
      .filter(([, deltas]) => deltas.length > 0)
  );
  expect(extra).toEqual({
    'insertNode table with a header row': [
      '.root.children: length 2 -> 3',
      '.root.children[1].colWidths: app-only [120,120]',
    ],
    'setBlockType paragraph to code with a language': [
      '.root.children: length 1 -> 2',
    ],
  });
});
