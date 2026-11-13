import type { DocumentOp } from '@ai-ops/editor';
import { FROM_LORO_TAG } from '@core/component/LexicalMarkdown/collaboration/CollabProvider';
import { $reconcileLexicalState } from '@core/component/LexicalMarkdown/collaboration/reconcile';
import { registerLoroHistory } from '@core/component/LexicalMarkdown/collaboration/undo';
import { loroSyncState } from '@core/component/LexicalMarkdown/utils';
import { registerList } from '@lexical/list';
import { $convertFromMarkdownString } from '@lexical/markdown';
import { registerRichText } from '@lexical/rich-text';
import { SyncDirection } from '@loro-mirror/core';
import {
  createLoroManager,
  type LoroManager,
} from '@macro-inc/collaboration/collab/manager';
import {
  $getId,
  $updateAllNodeIds,
  ALL_TRANSFORMERS,
  COLLABORATION_TAG,
  type NodeIdMappings,
  nodeIdPlugin,
} from '@macro-inc/lexical-core';
import { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import {
  NodeReplacements,
  SupportedNodeTypes,
} from '@macro-inc/lexical-core/node-list';
import {
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isParagraphNode,
  $isTextNode,
  $setSelection,
  CLEAR_HISTORY_COMMAND,
  createEditor,
  type LexicalEditor,
  ParagraphNode,
  type SerializedEditorState,
  TextNode,
  UNDO_COMMAND,
} from 'lexical';
import { LoroDoc } from 'loro-crdt';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { applyAiOps } from './applyAiOps';

// Source controls for the native AI-edit host: what the real OFF client does,
// captured before the native seam is written. Nothing here is native.

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

type Commit = {
  readonly tags: string[];
  readonly selection: string;
  readonly text: string;
  readonly dirtyElements: number;
};

type Rig = {
  readonly editor: LexicalEditor;
  readonly mappings: NodeIdMappings;
  readonly commits: Commit[];
  readonly mutations: string[];
  readonly settle: () => Promise<void>;
};

async function rig(markdown: string): Promise<Rig> {
  const editor = createEditor({
    namespace: 'ai-edit-source-controls',
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
  nodeIdPlugin({ nodes: SupportedNodeTypes, mappings })(editor);
  let manager!: LoroManager<typeof MARKDOWN_LORO_SCHEMA>;
  createRoot(() => {
    manager = createLoroManager(MARKDOWN_LORO_SCHEMA, { documentId: 'doc' });
  });
  await manager.initializeFromSnapshot(
    new LoroDoc().export({ mode: 'snapshot' })
  );
  const syncs: Promise<unknown>[] = [];
  editor.registerUpdateListener(({ editorState, tags, mutatedNodes }) => {
    if (tags.has(FROM_LORO_TAG) || !mutatedNodes?.size) return;
    syncs.push(manager.syncToLoro(loroSyncState(editorState) as never));
  });
  manager.onStateChange((update) => {
    if (update.metadata.direction === SyncDirection.TO_LORO) return;
    editor.update(
      () => {
        $reconcileLexicalState(
          editor.getEditorState().toJSON(),
          update.state as unknown as SerializedEditorState,
          mappings,
          () => manager.peerIdStr
        );
      },
      { discrete: true, tag: [FROM_LORO_TAG, COLLABORATION_TAG] }
    );
    queueMicrotask(() => editor.update(() => $updateAllNodeIds(mappings)));
  });
  registerLoroHistory(editor, manager, 300);
  editor.update(
    () => {
      $convertFromMarkdownString(markdown, ALL_TRANSFORMERS);
      $updateAllNodeIds(mappings);
    },
    { discrete: true }
  );
  const settle = async () => {
    await Promise.all(syncs);
    await new Promise((r) => setTimeout(r, 0));
  };
  await settle();
  editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);

  const commits: Commit[] = [];
  const mutations: string[] = [];
  editor.registerUpdateListener(({ editorState, tags, dirtyElements }) => {
    commits.push({
      tags: [...tags].sort(),
      selection: editorState.read(() => describeSelection()),
      text: editorState.read(() => $getRoot().getTextContent()),
      dirtyElements: dirtyElements.size,
    });
  });
  for (const klass of [TextNode, ParagraphNode])
    editor.registerMutationListener(
      klass,
      (nodes) => {
        for (const [key, kind] of nodes)
          mutations.push(`${commits.length}:${klass.getType()}:${kind}:${key}`);
      },
      { skipInitialization: true }
    );
  return { editor, mappings, commits, mutations, settle };
}

function describeSelection(): string {
  const selection = $getSelection();
  if (selection === null) return 'null';
  return selection.constructor.name;
}

/** The popup's state when AI edit is submitted: a range over "Alpha". */
function selectAlpha(editor: LexicalEditor): void {
  editor.update(
    () => {
      const text = $getRoot().getFirstDescendant();
      if (!$isTextNode(text)) throw new Error('expected text');
      const selection = $createRangeSelection();
      selection.anchor.set(text.getKey(), 0, 'text');
      selection.focus.set(text.getKey(), 5, 'text');
      $setSelection(selection);
    },
    { discrete: true }
  );
}

function blockIds(editor: LexicalEditor): string[] {
  return editor.read(() =>
    $getRoot()
      .getChildren()
      .map((c) => $getId(c) ?? '?')
  );
}

/** key → id for every node, to compare id lineage across a failure restore. */
function lineage(editor: LexicalEditor): Record<string, string> {
  const out: Record<string, string> = {};
  editor.read(() => {
    const walk = (node: ReturnType<typeof $getRoot>) => {
      out[node.getKey()] = $getId(node) ?? '';
      for (const child of 'getChildren' in node ? node.getChildren() : [])
        walk(child as never);
    };
    walk($getRoot());
  });
  return out;
}

type Capture = {
  name: string;
  threw: string | null;
  commitsDuringApply: Commit[];
  mutationsDuringApply: string[];
  textAfter: string;
  selectionAfter: string;
  lineageChanged: string[];
  mappingSizeBefore: number;
  mappingSizeAfter: number;
  undo1: string;
  undo2: string;
};

async function capture(
  name: string,
  markdown: string,
  build: (ids: string[]) => DocumentOp[],
  install?: (editor: LexicalEditor) => void
): Promise<Capture> {
  const r = await rig(markdown);
  selectAlpha(r.editor);
  install?.(r.editor);
  r.commits.length = 0;
  r.mutations.length = 0;
  const before = lineage(r.editor);
  const mappingSizeBefore = r.mappings.idToNodeKeyMap.size;
  let threw: string | null = null;
  try {
    applyAiOps(r.editor, r.mappings, build(blockIds(r.editor)));
  } catch (error) {
    threw = error instanceof Error ? error.constructor.name : String(error);
  }
  const commitsDuringApply = [...r.commits];
  const mutationsDuringApply = [...r.mutations];
  await r.settle();
  const after = lineage(r.editor);
  const lineageChanged = Object.keys({ ...before, ...after })
    .filter((key) => before[key] !== after[key])
    .map((key) => `${key}:${before[key] ?? '-'}->${after[key] ?? '-'}`);
  const textAfter = r.editor.read(() => $getRoot().getTextContent());
  const selectionAfter = r.editor.read(() => describeSelection());
  r.editor.dispatchCommand(UNDO_COMMAND, undefined);
  await r.settle();
  const undo1 = r.editor.read(() => $getRoot().getTextContent());
  r.editor.dispatchCommand(UNDO_COMMAND, undefined);
  await r.settle();
  const undo2 = r.editor.read(() => $getRoot().getTextContent());
  return {
    name,
    threw,
    commitsDuringApply,
    mutationsDuringApply,
    textAfter,
    selectionAfter,
    lineageChanged,
    mappingSizeBefore,
    mappingSizeAfter: r.mappings.idToNodeKeyMap.size,
    undo1,
    undo2,
  };
}

const SEED = 'Alpha beta gamma\n\nSecond line';
const all = { kind: 'all' } as const;

describe('Source applyAiOps controls', () => {
  it('records empty, success, first-refusal and mid-refusal lists', async () => {
    const captures = [
      await capture('empty', SEED, () => []),
      await capture('success', SEED, ([a]) => [
        {
          kind: 'replaceText',
          node: a,
          find: 'Alpha',
          to: 'ALPHA',
          scope: all,
        },
        { kind: 'appendText', node: a, text: ' (AI)' },
      ]),
      await capture('first refusal', SEED, ([a]) => [
        { kind: 'replaceText', node: a, find: 'zz', to: 'y', scope: all },
        { kind: 'appendText', node: a, text: ' never' },
      ]),
      await capture('mid refusal', SEED, ([a, b]) => [
        { kind: 'setText', node: a, text: 'Omega' },
        { kind: 'replaceText', node: b, find: 'zz', to: 'y', scope: all },
        { kind: 'setText', node: b, text: 'never applied' },
      ]),
    ];
    const out = process.env.AI_EDIT_SOURCE_CONTROLS_OUT;
    if (out) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(out, `${JSON.stringify(captures, null, 2)}\n`);
    }
    // Only facts read from applyAiOps/Doc source are asserted; the rest is captured.
    const [empty, success, first, mid] = captures;
    expect(empty?.threw).toBeNull();
    expect(empty?.selectionAfter).toBe('null');
    expect(success?.threw).toBeNull();
    expect(success?.textAfter).toContain('ALPHA beta gamma (AI)');
    expect(first?.threw).not.toBeNull();
    expect(first?.selectionAfter).toBe('null');
    expect(mid?.threw).not.toBeNull();
    expect(mid?.textAfter).toContain('Omega');
    expect(mid?.textAfter).not.toContain('never applied');
  });

  it('records a listener edit made between AI ops', async () => {
    // An update listener that, after the first AI op commits, edits the
    // second block itself: does it run between ops, and does undo keep it apart?
    let fired = false;
    const result = await capture(
      'listener edit between ops',
      SEED,
      ([a]) => [
        { kind: 'setText', node: a, text: 'Omega' },
        { kind: 'appendText', node: a, text: ' (AI)' },
      ],
      (editor) => {
        editor.registerUpdateListener(({ editorState }) => {
          if (fired) return;
          const text = editorState.read(() => $getRoot().getTextContent());
          if (!text.startsWith('Omega')) return;
          fired = true;
          editor.update(() => {
            const last = $getRoot().getLastChild();
            if ($isParagraphNode(last))
              last.append($createTextNode(' [listener]'));
          });
        });
      }
    );
    const out = process.env.AI_EDIT_SOURCE_LISTENER_OUT;
    if (out) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
    }
    expect(fired).toBe(true);
    expect(result.threw).toBeNull();
    const seed = 'Alpha beta gamma\n\nSecond line';
    // Commit 0 is applyAiOps' discrete $setSelection(null): selection only, no
    // dirty nodes, so history discards it. The listener's non-discrete update
    // is flushed into the next op's discrete commit, not a commit of its own.
    expect(
      result.commitsDuringApply.map(({ text, dirtyElements, selection }) => ({
        text,
        dirtyElements,
        selection,
      }))
    ).toEqual([
      { text: seed, dirtyElements: 0, selection: 'null' },
      { text: 'Omega\n\nSecond line', dirtyElements: 2, selection: 'null' },
      {
        text: 'Omega (AI)\n\nSecond line [listener]',
        dirtyElements: 3,
        selection: 'null',
      },
    ]);
    expect(result.textAfter).toBe('Omega (AI)\n\nSecond line [listener]');
    // One undo inside registerLoroHistory's 300 ms merge window reverts all.
    expect(result.undo1).toBe(seed);
  });

  it('records undo steps for two AI edits more than 300 ms apart', async () => {
    // Grouping is registerLoroHistory's time rule (getMergeAction plus Loro's
    // mergeInterval, both 300 ms), not a structural group per AI edit. Both
    // read the global Date.now() (getMergeAction directly; loro-crdt's wasm
    // glue imports only Date.now), so only Date is faked: edits land at
    // exactly 0 and `gap` ms, and timers (settle) stay real.
    const rows = [];
    const start = new Date('2026-01-01T00:00:00.000Z').getTime();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      for (const gap of [0, 400]) {
        vi.setSystemTime(start);
        const r = await rig(SEED);
        selectAlpha(r.editor);
        const [a, b] = blockIds(r.editor);
        if (!a || !b) throw new Error('expected two blocks');
        applyAiOps(r.editor, r.mappings, [
          { kind: 'appendText', node: a, text: ' [one]' },
        ]);
        await r.settle();
        vi.setSystemTime(start + gap);
        applyAiOps(r.editor, r.mappings, [
          { kind: 'appendText', node: b, text: ' [two]' },
        ]);
        await r.settle();
        const text = () => r.editor.read(() => $getRoot().getTextContent());
        const after = text();
        r.editor.dispatchCommand(UNDO_COMMAND, undefined);
        await r.settle();
        const undo1 = text();
        r.editor.dispatchCommand(UNDO_COMMAND, undefined);
        await r.settle();
        rows.push({ gap, after, undo1, undo2: text() });
      }
    } finally {
      vi.useRealTimers();
    }
    const out = process.env.AI_EDIT_SOURCE_UNDO_GAP_OUT;
    if (out) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(out, `${JSON.stringify(rows, null, 2)}\n`);
    }
    for (const row of rows)
      expect(row.after).toBe('Alpha beta gamma [one]\n\nSecond line [two]');
    const seed = 'Alpha beta gamma\n\nSecond line';
    // Within the window both edits are one undo step; past it, two.
    expect(
      rows.map(({ gap, undo1, undo2 }) => ({ gap, undo1, undo2 }))
    ).toEqual([
      { gap: 0, undo1: seed, undo2: seed },
      { gap: 400, undo1: 'Alpha beta gamma [one]\n\nSecond line', undo2: seed },
    ]);
  });
});
