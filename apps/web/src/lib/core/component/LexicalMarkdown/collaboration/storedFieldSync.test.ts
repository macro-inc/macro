// Source control on the real app editor composition: the block-md wrapper
// (createLexicalWrapper markdown-sync withIds), its base plugins with Loro history and
// registerMarkdownEditing. The load and sync wiring is a replica of
// collaboration/CollabProvider.tsx at git blob db6531bfc6f7: the versioned-state load
// (initializeEditorWithVersionedState, :565), syncLexicalToLoro's skip tags and first-sync
// gate (:410, :433, :441) and codeNodeUpdateHandler (:355). Re-check it against that file
// when the blob changes.

import {
  CODE_HIGHLIGHT_IDS_TAG,
  FROM_LORO_TAG,
} from '@core/component/LexicalMarkdown/collaboration/CollabProvider';
import {
  createLexicalWrapper,
  isWrapperWithIds,
} from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import { registerMarkdownEditing } from '@core/component/LexicalMarkdown/editing/registerMarkdownEditing';
import {
  initializeEditorWithVersionedState,
  loroSyncState,
} from '@core/component/LexicalMarkdown/utils';
import { MARKDOWN_VERSION_COUNTER } from '@core/component/LexicalMarkdown/version';
import {
  $isCodeNode as $isLexicalCodeNode,
  CodeHighlightNode,
  CodeNode,
} from '@lexical/code-core';
import { $convertFromMarkdownString } from '@lexical/markdown';
import {
  createLoroManager,
  type LoroManager,
} from '@macro-inc/collaboration/collab/manager';
import {
  $isCustomCodeNode,
  $updateAllNodeIds,
  ALL_TRANSFORMERS,
  COLLABORATION_TAG,
  CustomCodeNode,
  LOCAL_STATUS_TAG,
} from '@macro-inc/lexical-core';
import { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import { ClassedBlockNode } from '@macro-inc/lexical-core/nodes/ClassedBlockNode';
import { PullRequestMentionNode } from '@macro-inc/lexical-core/nodes/PullRequestMentionNode';
import {
  $createParagraphNode,
  $getNodeByKey,
  $getRoot,
  $isElementNode,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  type NodeKey,
  type SerializedEditorState,
  type UpdateListenerPayload,
} from 'lexical';
import { LoroDoc } from 'loro-crdt';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@core/internal/BlockLoader', () => ({}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|control@example.com',
}));
// The editor utilities pull in the plugin barrel, whose leaves open the
// storage and connection-gateway sockets on import.
vi.mock('@service-storage/websocket', () => ({
  storageWS: {
    send() {},
    addEventListener() {},
    removeEventListener() {},
    reconnectIfDisconnected() {},
  },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { send() {}, addEventListener() {}, removeEventListener() {} },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
  parseWebsocketPayload: () => undefined,
}));

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonNode = { [key: string]: Json };
type Verdict = 'delete' | 'keep' | `write ${string}`;
type Case = {
  name: string;
  type: string;
  field: string;
  stored: Json;
  source: Verdict;
};

const MARKDOWN = [
  'start',
  '',
  '- bullet',
  '',
  '- [ ] check',
  '',
  '```js',
  'x',
  '```',
  '',
  '| a | b |',
  '| --- | --- |',
  '| c | d |',
].join('\n');

// Each case stores one field on every node of its type, then loads the doc the
// way CollabProvider does and makes one local edit at the end of the document.
const CASES: Omit<Case, 'source'>[] = [
  ...['frozenColumnCount', 'frozenRowCount'].flatMap((field) =>
    [null, 0, 2].map((stored) => ({ type: 'table', field, stored }))
  ),
  ...[null, false, true].map((stored) => ({
    type: 'table',
    field: 'rowStriping',
    stored,
  })),
  ...[null, [90, 110]].map((stored) => ({
    type: 'table',
    field: 'colWidths',
    stored,
  })),
  ...[null, 0, 150].map((stored) => ({
    type: 'tablecell',
    field: 'width',
    stored,
  })),
  ...[null, false, true].map((stored) => ({
    type: 'listitem/bullet',
    field: 'checked',
    stored,
  })),
  ...[null, false].map((stored) => ({
    type: 'listitem/check',
    field: 'checked',
    stored,
  })),
  ...[null, '', 'python'].map((stored) => ({
    type: 'custom-code',
    field: 'language',
    stored,
  })),
  ...[null, 'dark'].map((stored) => ({
    type: 'custom-code',
    field: 'theme',
    stored,
  })),
  ...[null, '', 'keyword'].map((stored) => ({
    type: 'code-highlight',
    field: 'highlightType',
    stored,
  })),
  ...[null, 'https://github.com/o/r/pull/2'].map((stored) => ({
    type: 'pr-mention',
    field: 'url',
    stored,
  })),
  ...[null, { 'data-x': 'y' }].map((stored) => ({
    type: 'classed-block',
    field: 'attributes',
    stored,
  })),
  // A GitHub PR URL stored as the id: Source's constructor moves it into url.
  { type: 'pr-mention/url-id', field: 'url', stored: null },
].map((entry) => ({
  ...entry,
  name: `${entry.type}.${entry.field}=${JSON.stringify(entry.stored)}`,
}));

// Source's verdict per case: what the first local sync after load writes for the
// stored field. Every case must store the field on at least one node.
const EXPECTED: Record<string, Verdict> = {
  'table.frozenColumnCount=null': 'delete',
  'table.frozenColumnCount=0': 'delete',
  'table.frozenColumnCount=2': 'keep',
  'table.frozenRowCount=null': 'delete',
  'table.frozenRowCount=0': 'delete',
  'table.frozenRowCount=2': 'keep',
  'table.rowStriping=null': 'delete',
  'table.rowStriping=false': 'delete',
  'table.rowStriping=true': 'keep',
  'table.colWidths=null': 'keep',
  'table.colWidths=[90,110]': 'keep',
  'tablecell.width=null': 'delete',
  'tablecell.width=0': 'delete',
  'tablecell.width=150': 'keep',
  'listitem/bullet.checked=null': 'delete',
  'listitem/bullet.checked=false': 'delete',
  'listitem/bullet.checked=true': 'delete',
  'listitem/check.checked=null': 'write false',
  'listitem/check.checked=false': 'keep',
  'custom-code.language=null': 'delete',
  'custom-code.language=""': 'delete',
  'custom-code.language="python"': 'keep',
  'custom-code.theme=null': 'delete',
  'custom-code.theme="dark"': 'keep',
  'code-highlight.highlightType=null': 'delete',
  'code-highlight.highlightType=""': 'delete',
  'code-highlight.highlightType="keyword"': 'keep',
  'pr-mention.url=null': 'delete',
  'pr-mention.url="https://github.com/o/r/pull/2"': 'keep',
  'classed-block.attributes=null': 'delete',
  'classed-block.attributes={"data-x":"y"}': 'delete',
  'pr-mention/url-id.url=null': 'write "https://github.com/o/r/pull/3"',
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Wait until the editor and its sync are idle: every queued Loro write has resolved and
 * a further macrotask queues no new write and adds no op. Fails rather than reading a
 * state that is still changing.
 */
async function settleUntilIdle(loro: Loaded, writes: Promise<unknown>[]) {
  for (let round = 0; round < 200; round++) {
    const queued = writes.length;
    const before = JSON.stringify(loro.doc.oplogVersion().toJSON());
    await Promise.all(writes);
    await settle();
    if (
      writes.length === queued &&
      JSON.stringify(loro.doc.oplogVersion().toJSON()) === before
    ) {
      return;
    }
  }
  throw new Error('editor sync did not go idle');
}

type Loaded = LoroManager<typeof MARKDOWN_LORO_SCHEMA>;

/** The block-md wrapper with the app's base plugins and registerMarkdownEditing. */
function appEditor(namespace: string, loro?: Loaded) {
  const wrapper = createLexicalWrapper({
    type: 'markdown-sync',
    namespace,
    isInteractable: () => true,
    withIds: true,
  });
  if (!isWrapperWithIds(wrapper)) throw new Error('expected node ids');
  wrapper.editor.setRootElement(document.createElement('div'));
  wrapper.plugins
    .richText()
    .list()
    .markdownShortcuts()
    .delete()
    .history(400, loro);
  registerMarkdownEditing({
    lexicalWrapper: wrapper,
    isContentEditable: () => true,
    peerIdValidator: () => true,
    source: { id: 'control', trackMentions: false },
    onVersionError: (error) => {
      throw new Error(`version error ${error}`);
    },
  });
  return wrapper;
}

/** CollabProvider.syncLexicalToLoro and codeNodeUpdateHandler, as written there. */
function wireSync(
  wrapper: ReturnType<typeof appEditor>,
  loro: Loaded,
  writes: Promise<unknown>[]
) {
  const { editor, mapping: mappings } = wrapper;
  const writeState = () =>
    writes.push(
      loro.syncToLoro(loroSyncState(editor.getEditorState()) as never)
    );
  const codeIdsPass = (
    mutatedNodes: UpdateListenerPayload['mutatedNodes']
  ): boolean => {
    if (!mutatedNodes || mutatedNodes.size === 0) return false;
    const keys = new Set<NodeKey>();
    for (const [klass, mutations] of mutatedNodes) {
      if (
        klass === CodeHighlightNode ||
        klass === CodeNode ||
        klass === CustomCodeNode
      ) {
        for (const [key, mutation] of mutations) {
          if (mutation !== 'destroyed') keys.add(key);
        }
      }
    }
    if (keys.size > 0) {
      editor.update(
        () => {
          const parents = new Set<CodeNode | CustomCodeNode>();
          for (const key of keys) {
            const node = $getNodeByKey(key);
            if ($isLexicalCodeNode(node) || $isCustomCodeNode(node)) {
              parents.add(node);
              continue;
            }
            const parent = node?.getParent() ?? null;
            if ($isLexicalCodeNode(parent) || $isCustomCodeNode(parent))
              parents.add(parent);
          }
          for (const node of parents) $updateAllNodeIds(mappings, node);
        },
        { discrete: true, tag: CODE_HIGHLIGHT_IDS_TAG, onUpdate: writeState }
      );
    }
    return keys.size > 0;
  };
  return editor.registerUpdateListener(({ tags, mutatedNodes }) => {
    if (
      tags.has(FROM_LORO_TAG) ||
      tags.has(COLLABORATION_TAG) ||
      tags.has(LOCAL_STATUS_TAG) ||
      tags.has(CODE_HIGHLIGHT_IDS_TAG)
    ) {
      return;
    }
    if (mutatedNodes && mutatedNodes.size > 0 && !codeIdsPass(mutatedNodes)) {
      writeState();
    }
  });
}

async function manager(
  documentId: string,
  snapshot: Uint8Array
): Promise<LoroManager<typeof MARKDOWN_LORO_SCHEMA>> {
  let created!: LoroManager<typeof MARKDOWN_LORO_SCHEMA>;
  createRoot(() => {
    created = createLoroManager(MARKDOWN_LORO_SCHEMA, { documentId });
  });
  await created.initializeFromSnapshot(snapshot);
  return created;
}

function baseState(): SerializedEditorState {
  const wrapper = appEditor('stored-field-seed');
  const { editor, mapping: mappings } = wrapper;
  editor.update(
    () => {
      $convertFromMarkdownString(MARKDOWN, ALL_TRANSFORMERS);
      const root = $getRoot();
      root.append(
        new ClassedBlockNode('div', ['note']).append($createParagraphNode())
      );
      root.append(
        $createParagraphNode().append(new PullRequestMentionNode('o/r#1', 'PR'))
      );
      root.append($createParagraphNode());
      $updateAllNodeIds(mappings);
    },
    { discrete: true }
  );
  // A JSON round trip drops undefined fields, so the seed stores only the field
  // under test; the mirror would otherwise insert them as null. The seed carries
  // current metadata, as an ordinary document does.
  const state = JSON.parse(
    JSON.stringify(loroSyncState(editor.getEditorState()))
  ) as SerializedEditorState;
  const root = state.root as unknown as JsonNode;
  root.$ = {
    ...((root.$ as JsonNode | undefined) ?? {}),
    documentMetadata: { version: MARKDOWN_VERSION_COUNTER },
  };
  wrapper.cleanup();
  return state;
}

function visit(
  node: JsonNode,
  parent: JsonNode | null,
  each: (node: JsonNode, parent: JsonNode | null) => void
) {
  each(node, parent);
  const children = node.children;
  if (Array.isArray(children)) {
    for (const child of children) visit(child as JsonNode, node, each);
  }
}

const PR_URL_ID = 'https://github.com/o/r/pull/3';

function seed(state: SerializedEditorState, entry: Omit<Case, 'source'>) {
  const seeded = structuredClone(state);
  let matched = 0;
  const root = seeded.root as unknown as JsonNode;
  visit(root, null, (node, parent) => {
    const matches = (() => {
      if (entry.type === 'listitem/bullet')
        return node.type === 'listitem' && parent?.listType === 'bullet';
      if (entry.type === 'listitem/check')
        return node.type === 'listitem' && parent?.listType === 'check';
      if (
        entry.type === 'code-highlight' &&
        node.type === 'text' &&
        parent?.type === 'custom-code'
      ) {
        node.type = 'code-highlight';
        return true;
      }
      if (entry.type === 'pr-mention/url-id' && node.type === 'pr-mention') {
        node.id = PR_URL_ID;
        return true;
      }
      return node.type === entry.type;
    })();
    if (matches) {
      node[entry.field] = structuredClone(entry.stored);
      matched += 1;
    }
  });
  return { seeded, matched };
}

function mapActions(
  doc: LoroDoc,
  from: ReturnType<LoroDoc['oplogVersion']>,
  field: string
): string[] {
  const updates = doc.exportJsonUpdates(
    from,
    doc.oplogVersion()
  ) as unknown as {
    changes: {
      ops: { content: { type: string; key?: string; value?: unknown } }[];
    }[];
  };
  const actions = new Set<string>();
  for (const change of updates.changes) {
    for (const op of change.ops) {
      if (op.content.key !== field) continue;
      actions.add(
        op.content.type === 'delete'
          ? 'delete'
          : `write ${JSON.stringify(op.content.value)}`
      );
    }
  }
  return [...actions].sort();
}

async function runCase(
  state: SerializedEditorState,
  entry: Omit<Case, 'source'>
) {
  const { seeded, matched } = seed(state, entry);
  expect(matched, entry.name).toBeGreaterThan(0);
  const writer = await manager(
    'seed',
    new LoroDoc().export({ mode: 'snapshot' })
  );
  await writer.syncToLoro(seeded as never);
  const snapshot = writer.doc.export({ mode: 'snapshot' });

  const loaded = await manager('doc', snapshot);
  const opened = loaded.doc.oplogVersion();
  const wrapper = appEditor('stored-field-load', loaded);
  const { editor } = wrapper;
  // CollabProvider's versioned-state load, then startSync.
  const initError = initializeEditorWithVersionedState(
    editor,
    loaded.state?.state as unknown as SerializedEditorState,
    () => loaded.peerIdStr
  );
  expect(initError).toBeNull();
  const writes: Promise<unknown>[] = [];
  wireSync(wrapper, loaded, writes);
  await settleUntilIdle(loaded, writes);
  // One keystroke at the end of the trailing paragraph.
  editor.update(
    () => {
      const last = $getRoot().getLastChild();
      if ($isElementNode(last)) last.selectEnd();
    },
    { discrete: true }
  );
  editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, '!');
  await settleUntilIdle(loaded, writes);
  const actions = mapActions(loaded.doc, opened, entry.field);
  const source: Verdict =
    actions.length === 0 ? 'keep' : (actions.join(', ') as Verdict);
  wrapper.cleanup();
  return { ...entry, source, snapshot };
}

describe('Source stored-field sync', () => {
  it('records what the first local sync after load writes for each stored field', async () => {
    const state = baseState();
    const results = [];
    for (const entry of CASES) results.push(await runCase(state, entry));
    // Writes the native fixture: each case's stored snapshot plus Source's verdict.
    const out = process.env.SOURCE_STORED_FIELD_OUT;
    if (out) {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      mkdirSync(out, { recursive: true });
      const cases = results.map(({ snapshot, ...result }, index) => {
        const file = `${String(index).padStart(2, '0')}.loro`;
        writeFileSync(`${out}/${file}`, snapshot);
        return { ...result, file };
      });
      writeFileSync(`${out}/cases.json`, `${JSON.stringify(cases, null, 2)}\n`);
    }
    expect(
      Object.fromEntries(results.map((result) => [result.name, result.source]))
    ).toEqual(EXPECTED);
  });
});
