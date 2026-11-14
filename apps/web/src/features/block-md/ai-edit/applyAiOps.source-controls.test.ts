import type { DocumentOp } from '@ai-ops/editor';
import { FROM_LORO_TAG } from '@core/component/LexicalMarkdown/collaboration/CollabProvider';
import { $reconcileLexicalState } from '@core/component/LexicalMarkdown/collaboration/reconcile';
import {
  createLexicalWrapper,
  isWrapperWithIds,
} from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import { registerMarkdownEditing } from '@core/component/LexicalMarkdown/editing/registerMarkdownEditing';
import { loroSyncState } from '@core/component/LexicalMarkdown/utils';
import { $convertFromMarkdownString } from '@lexical/markdown';
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
} from '@macro-inc/lexical-core';
import { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import { Telemetry } from '@macro-inc/observability';
import {
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  CLEAR_HISTORY_COMMAND,
  type LexicalEditor,
  ParagraphNode,
  type SerializedEditorState,
  TextNode,
  UNDO_COMMAND,
} from 'lexical';
import { LoroDoc, UndoManager } from 'loro-crdt';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { applyAiOps } from './applyAiOps';

// Source controls for the native AI-edit host: what the real OFF client does,
// captured before the native seam is written. Nothing here is native. The
// editor is block-md MarkdownEditor's: createLexicalWrapper('markdown-sync'),
// its base plugins with history(400, loroManager), and registerMarkdownEditing;
// the Loro listeners below stand in for CollabProvider's sync. Its onError is
// Telemetry.error, so a failing op is reported and dropped, not thrown (live
// OFF confirmation: w-ai-generate/source-controls/live-20261113/live-refusal.json).

vi.mock('@core/internal/BlockLoader', () => ({}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|controls@example.com',
}));

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
  /** Nodes created, updated or destroyed, over every node class. */
  readonly mutated: number;
  /** The committed state is the previous state object itself. */
  readonly sameState: boolean;
};

type Reported = {
  readonly kind: string;
  readonly message: string;
  readonly attributes: unknown;
};

type Rig = {
  readonly editor: LexicalEditor;
  readonly mappings: NodeIdMappings;
  readonly commits: Commit[];
  readonly mutations: string[];
  readonly reported: Reported[];
  readonly settle: () => Promise<void>;
};

async function rig(markdown: string): Promise<Rig> {
  let manager!: LoroManager<typeof MARKDOWN_LORO_SCHEMA>;
  const wrapper = createRoot(() => {
    manager = createLoroManager(MARKDOWN_LORO_SCHEMA, { documentId: 'doc' });
    const created = createLexicalWrapper({
      type: 'markdown-sync',
      namespace: 'ai-edit-source-controls',
      isInteractable: () => true,
      withIds: true,
    });
    if (!isWrapperWithIds(created)) throw new Error('expected node ids');
    created.plugins
      .richText()
      .list()
      .markdownShortcuts()
      .delete()
      .history(400, manager);
    registerMarkdownEditing({
      lexicalWrapper: created,
      isContentEditable: () => true,
      peerIdValidator: () => true,
      source: { id: 'doc', trackMentions: false },
      onVersionError: (error) => {
        throw new Error(`version error ${error}`);
      },
    });
    return created;
  });
  const { editor, mapping: mappings } = wrapper;
  editor.setRootElement(document.createElement('div'));
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
  editor.registerUpdateListener(
    ({ editorState, prevEditorState, tags, dirtyElements, mutatedNodes }) => {
      commits.push({
        tags: [...tags].sort(),
        selection: editorState.read(() => describeSelection()),
        text: editorState.read(() => $getRoot().getTextContent()),
        dirtyElements: dirtyElements.size,
        mutated: [...(mutatedNodes?.values() ?? [])].reduce(
          (total, nodes) => total + nodes.size,
          0
        ),
        sameState: editorState === prevEditorState,
      });
    }
  );
  for (const klass of [TextNode, ParagraphNode])
    editor.registerMutationListener(
      klass,
      (nodes) => {
        for (const [key, kind] of nodes)
          mutations.push(`${commits.length}:${klass.getType()}:${kind}:${key}`);
      },
      { skipInitialization: true }
    );
  const reported: Reported[] = [];
  vi.spyOn(Telemetry, 'error').mockImplementation((error, attributes) => {
    reported.push({
      kind: error instanceof Error ? error.constructor.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      attributes,
    });
  });
  return { editor, mappings, commits, mutations, reported, settle };
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
  reported: Reported[];
  idsAfter: string[];
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
  r.reported.length = 0;
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
  const reported = [...r.reported];
  await r.settle();
  const idsAfter = blockIds(r.editor);
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
    reported,
    idsAfter,
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
        { kind: 'appendText', node: a, text: ' after' },
      ]),
      await capture('mid refusal', SEED, ([a, b]) => [
        { kind: 'setText', node: a, text: 'Omega' },
        { kind: 'replaceText', node: b, find: 'zz', to: 'y', scope: all },
        { kind: 'setText', node: b, text: 'applied after' },
      ]),
    ];
    const out = process.env.AI_EDIT_SOURCE_CONTROLS_OUT;
    if (out) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(out, `${JSON.stringify(captures, null, 2)}\n`);
    }
    // A refused op is dropped, not thrown: Lexical's beginUpdate hands the
    // error to onError (Telemetry.error), restores the state before the op and
    // commits that unchanged state; later ops apply on top of it.
    const reportedAs = {
      kind: 'Error',
      attributes: {
        'error.source': 'lexical',
        'lexical.editor_type': 'markdown-sync',
      },
    };
    const summary = captures.map((c) => ({
      name: c.name,
      threw: c.threw,
      commits: c.commitsDuringApply.map((x) => [
        x.text,
        x.dirtyElements,
        x.mutated,
      ]),
      reported: c.reported.map(({ kind, attributes }) => ({
        kind,
        attributes,
      })),
      text: c.textAfter,
      selection: c.selectionAfter,
      mapping: [c.mappingSizeBefore, c.mappingSizeAfter],
      undo1: c.undo1,
    }));
    const seed = 'Alpha beta gamma\n\nSecond line';
    expect(summary).toEqual([
      {
        name: 'empty',
        threw: null,
        commits: [[seed, 0, 0]],
        reported: [],
        text: seed,
        selection: 'null',
        mapping: [5, 5],
        undo1: seed,
      },
      {
        name: 'success',
        threw: null,
        commits: [
          [seed, 0, 0],
          ['ALPHA beta gamma\n\nSecond line', 2, 1],
          ['ALPHA beta gamma (AI)\n\nSecond line', 2, 1],
        ],
        reported: [],
        text: 'ALPHA beta gamma (AI)\n\nSecond line',
        selection: 'null',
        mapping: [5, 5],
        undo1: seed,
      },
      {
        name: 'first refusal',
        threw: null,
        commits: [
          [seed, 0, 0],
          [seed, 0, 0],
          ['Alpha beta gamma after\n\nSecond line', 2, 1],
        ],
        reported: [reportedAs],
        text: 'Alpha beta gamma after\n\nSecond line',
        selection: 'null',
        mapping: [5, 5],
        undo1: seed,
      },
      {
        name: 'mid refusal',
        threw: null,
        commits: [
          [seed, 0, 0],
          ['Omega\n\nSecond line', 2, 1],
          ['Omega\n\nSecond line', 0, 0],
          ['Omega\n\napplied after', 2, 1],
        ],
        reported: [reportedAs],
        text: 'Omega\n\napplied after',
        selection: 'null',
        mapping: [5, 5],
        undo1: seed,
      },
    ]);
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
    // One undo inside the 400 ms merge window reverts all.
    expect(result.undo1).toBe(seed);
  });

  it('records the refused-op tape the live OFF app ran', async () => {
    // live-20261113/live-refusal.json: [insert 'kept' after the selected
    // block, remove an unknown id, remove the selected block].
    const result = await capture(
      'insert, failing remove, remove',
      SEED,
      ([a]) =>
        [
          {
            kind: 'insertNode',
            ref: 'ref-kept',
            spec: { block: 'paragraph', text: 'kept' },
            at: { after: a },
          },
          { kind: 'removeNode', node: 'missing-id' },
          { kind: 'removeNode', node: a },
        ] as DocumentOp[]
    );
    const out = process.env.AI_EDIT_SOURCE_TAPE_OUT;
    if (out) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
    }
    // Same final text, no throw (so no toast) and the same Telemetry cause as live.
    const seed = 'Alpha beta gamma\n\nSecond line';
    expect(result.threw).toBeNull();
    expect(result.textAfter).toBe('kept\n\nSecond line');
    expect(result.idsAfter[0]).toBe('ref-kept');
    expect(result.idsAfter).toHaveLength(2);
    expect(
      result.commitsDuringApply.map((x) => [x.text, x.dirtyElements])
    ).toEqual([
      [seed, 0],
      ['Alpha beta gamma\n\nkept\n\nSecond line', 4],
      ['Alpha beta gamma\n\nkept\n\nSecond line', 0],
      ['kept\n\nSecond line', 3],
    ]);
    // The refused op's commit: no tags, no dirty or mutated nodes, selection
    // still null. Update listeners see it; none that guard on dirty or mutated
    // nodes act on it (seam README, rev 7.1).
    expect(result.commitsDuringApply[2]).toEqual({
      tags: [],
      selection: 'null',
      text: 'Alpha beta gamma\n\nkept\n\nSecond line',
      dirtyElements: 0,
      mutated: 0,
      sameState: true,
    });
    expect(result.reported).toEqual([
      {
        kind: 'Error',
        message: 'No node with id "missing-id"',
        attributes: {
          'error.source': 'lexical',
          'lexical.editor_type': 'markdown-sync',
        },
      },
    ]);
    // Insert adds two ids and the remove drops two: the mapping is not re-synced.
    expect([result.mappingSizeBefore, result.mappingSizeAfter]).toEqual([5, 5]);
    expect(result.undo1).toBe(seed);
  });

  it('records undo steps for two AI edits around the 400 ms window', async () => {
    // Grouping is registerLoroHistory's time rule (getMergeAction and Loro's
    // mergeInterval, both history(400)), not a structural group per AI edit.
    // Both read the global Date.now() (getMergeAction directly; loro-crdt's
    // wasm glue imports only Date.now), so only Date is faked: edits land at
    // exactly 0 and `gap` ms, and timers (settle) stay real.
    const rows = [];
    const start = new Date('2026-01-01T00:00:00.000Z').getTime();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      for (const gap of [0, 399, 400, 500]) {
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
    const seed = 'Alpha beta gamma\n\nSecond line';
    const first = 'Alpha beta gamma [one]\n\nSecond line';
    for (const row of rows)
      expect(row.after).toBe('Alpha beta gamma [one]\n\nSecond line [two]');
    // Merged when the second edit is less than 400 ms after the first.
    expect(
      rows.map(({ gap, undo1, undo2 }) => ({ gap, undo1, undo2 }))
    ).toEqual([
      { gap: 0, undo1: seed, undo2: seed },
      { gap: 399, undo1: seed, undo2: seed },
      { gap: 400, undo1: first, undo2: seed },
      { gap: 500, undo1: first, undo2: seed },
    ]);
  });

  it('typing undo follows the wall clock', async () => {
    // Source has one clock for history: Date.now (getMergeAction and Loro's
    // mergeInterval). Two typed characters 100 ms or 10 s apart on it, and
    // one with the wall clock moved 500 ms back between them.
    const rows: { gap: number; undo1: string }[] = [];
    const start = new Date('2026-01-01T00:00:00.000Z').getTime();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      for (const gap of [100, 10_000, -500]) {
        vi.setSystemTime(start);
        const r = await rig(SEED);
        r.editor.update(
          () => {
            const text = $getRoot().getFirstDescendant();
            if (!$isTextNode(text)) throw new Error('expected text');
            text.select(text.getTextContentSize(), text.getTextContentSize());
          },
          { discrete: true }
        );
        await r.settle();
        const type = (character: string) =>
          r.editor.update(
            () => {
              const selection = $getSelection();
              if (!$isRangeSelection(selection))
                throw new Error('expected a caret');
              selection.insertText(character);
            },
            { discrete: true }
          );
        vi.setSystemTime(start + 1_000);
        type('a');
        await r.settle();
        vi.setSystemTime(start + 1_000 + gap);
        type('b');
        await r.settle();
        expect(r.editor.read(() => $getRoot().getTextContent())).toBe(
          'Alpha beta gammaab\n\nSecond line'
        );
        r.editor.dispatchCommand(UNDO_COMMAND, undefined);
        await r.settle();
        rows.push({
          gap,
          undo1: r.editor.read(() => $getRoot().getTextContent()),
        });
      }
    } finally {
      vi.useRealTimers();
    }
    expect(rows).toEqual([
      { gap: 100, undo1: SEED },
      { gap: 10_000, undo1: 'Alpha beta gammaa\n\nSecond line' },
      // A backwards jump is a negative delta, under both 400 ms rules: merged.
      { gap: -500, undo1: SEED },
    ]);
  });

  it('records Loro mergeInterval alone around 400 ms', async () => {
    // getMergeAction merges only while changeTime < prev + 400; this is
    // Loro's own comparison, without Lexical in front of it.
    const rows: { gap: number; afterOneUndo: string }[] = [];
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      for (const gap of [0, 399, 400, 401, 500]) {
        vi.setSystemTime(1_000_000);
        const doc = new LoroDoc();
        const undo = new UndoManager(doc, { mergeInterval: 400 });
        const text = doc.getText('t');
        text.insert(0, 'a');
        doc.commit();
        vi.setSystemTime(1_000_000 + gap);
        text.insert(1, 'b');
        doc.commit();
        undo.undo();
        rows.push({ gap, afterOneUndo: text.toString() });
      }
    } finally {
      vi.useRealTimers();
    }
    const out = process.env.AI_EDIT_SOURCE_LORO_INTERVAL_OUT;
    if (out) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(out, `${JSON.stringify(rows, null, 2)}\n`);
    }
    // Same side as getMergeAction: merged below 400 ms, split at 400.
    expect(rows).toEqual([
      { gap: 0, afterOneUndo: '' },
      { gap: 399, afterOneUndo: '' },
      { gap: 400, afterOneUndo: 'a' },
      { gap: 401, afterOneUndo: 'a' },
      { gap: 500, afterOneUndo: 'a' },
    ]);
  });
});
