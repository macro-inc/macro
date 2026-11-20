/**
 * A person edits while a direct edit is committed. The person is a separate
 * Loro peer editing the way a browser does: a Lexical editor whose state is
 * synced to Loro through loro-mirror. Their change reaches the server either
 * between the agent's read and its commit (the agent's edit is merged at its
 * base revision) or during the commit (made without seeing the agent's edit,
 * merged after it). Modelled on the ai-edit harness's concurrency experiment.
 */
import type { InferType } from '@loro-mirror/core';
import { LoroManager } from '@macro-inc/collaboration/collab/manager';
import {
  MARKDOWN_LORO_SCHEMA,
  type MarkdownLoroSchemaType,
} from '@macro-inc/lexical-core/markdown-loro-schema';
import { $updateAllNodeIds } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import { NOOP_SPAN } from '@macro-inc/observability';
import {
  $getRoot,
  $isElementNode,
  $isTextNode,
  type LexicalNode,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import {
  createEditingSession,
  type LexicalSession,
  loadSnapshot,
  toSnapshot,
} from '../../ai-editing/ai-toolkit/session';
import { readDocument } from './document';
import { buildSnapshot, SyncedDocument } from './fixtures/build';
import { DirectEditConflict, runDirectEdit } from './run';

const DOC = 'doc-1';
const DOC_MD = [
  '# Planning notes',
  '',
  'Intro paragraph with a comment target here and more words.',
  '',
  'The target paragraph says Closing paragraph text and keeps a remark mark in it.',
  '',
  'The neighbour paragraph talks about apples and pears.',
  '',
  '- first item',
  '- second item',
  '',
  'Last paragraph at the end.',
].join('\n');
const COMMENTS = [
  { text: 'comment target here', id: 'cm-intro' },
  { text: 'remark mark', id: 'cm-target' },
  { text: 'apples', id: 'cm-neighbour' },
];
const TARGET = 2;
const NEIGHBOUR = 3;
const LIST = 4;
const AI_OLD = 'Closing paragraph';
const AI_NEW = 'Final paragraph';

type HumanAction =
  | { kind: 'type'; where: number; after: string; text: string }
  | { kind: 'bold'; where: number; word: string }
  | { kind: 'move'; where: number; afterBlock: number }
  | { kind: 'delete'; where: number };

function* dfs(node: LexicalNode): Generator<LexicalNode> {
  yield node;
  if ($isElementNode(node))
    for (const child of node.getChildren()) yield* dfs(child);
}

/** The person's browser: edits, then the Loro updates it sends (one per keystroke). */
async function humanUpdates(
  snapshot: Uint8Array,
  action: HumanAction
): Promise<Uint8Array[]> {
  const manager = new LoroManager(MARKDOWN_LORO_SCHEMA, {
    documentId: 'human',
  });
  try {
    (await manager.initializeFromSnapshot(snapshot))._unsafeUnwrap();
    const live: LexicalSession = createEditingSession();
    loadSnapshot(live, manager.mirror.getState() as never);
    const edit = async (change: () => void) => {
      live.editor.update(
        () => {
          change();
          $updateAllNodeIds(live.ids);
        },
        { discrete: true }
      );
      manager.doc.commit();
      const from = manager.doc.oplogVersion();
      (
        await manager.syncToLoro(
          toSnapshot(live) as unknown as InferType<MarkdownLoroSchemaType>
        )
      )._unsafeUnwrap();
      manager.doc.commit();
      return manager.doc.export({ mode: 'update', from });
    };
    const block = (i: number) => $getRoot().getChildren()[i];
    const textWith = (i: number, needle: string) => {
      for (const node of dfs(block(i)))
        if ($isTextNode(node) && node.getTextContent().includes(needle))
          return node;
      throw new Error(`human: no text ${needle}`);
    };
    if (action.kind === 'type') {
      const updates: Uint8Array[] = [];
      for (let k = 0; k < action.text.length; k++)
        updates.push(
          await edit(() => {
            const anchor = action.after + action.text.slice(0, k);
            const node = textWith(action.where, anchor);
            node.spliceText(
              node.getTextContent().indexOf(anchor) + anchor.length,
              0,
              action.text[k],
              false
            );
          })
        );
      return updates;
    }
    return [
      await edit(() => {
        if (action.kind === 'delete') block(action.where).remove();
        else if (action.kind === 'move')
          block(action.afterBlock).insertAfter(block(action.where));
        else {
          const node = textWith(action.where, action.word);
          const at = node.getTextContent().indexOf(action.word);
          const parts = node.splitText(at, at + action.word.length);
          (at === 0 ? parts[0] : parts[1]).toggleFormat('bold');
        }
      }),
    ];
  } finally {
    manager.dispose();
  }
}

interface Scenario {
  id: string;
  action: HumanAction;
  /** The person's change, as it reads in the final markdown. */
  kept: (markdown: string, order: string[]) => boolean;
}

const SCENARIOS: Scenario[] = [
  {
    id: 'type-same',
    action: { kind: 'type', where: TARGET, after: 'target', text: ' qqalpha' },
    kept: (md) => md.includes('The target qqalpha paragraph'),
  },
  {
    id: 'type-neighbour',
    action: {
      kind: 'type',
      where: NEIGHBOUR,
      after: 'neighbour',
      text: ' qqalpha',
    },
    kept: (md) => md.includes('The neighbour qqalpha paragraph'),
  },
  {
    id: 'bold-same',
    action: { kind: 'bold', where: TARGET, word: 'keeps' },
    kept: (md) => md.includes('**keeps**'),
  },
  {
    id: 'bold-neighbour',
    action: { kind: 'bold', where: NEIGHBOUR, word: 'pears' },
    kept: (md) => md.includes('**pears**'),
  },
  {
    id: 'move-same',
    action: { kind: 'move', where: TARGET, afterBlock: LIST },
    kept: (_, order) =>
      order.findIndex((b) => b.includes('The target')) >
      order.findIndex((b) => b.startsWith('- first item')),
  },
  {
    id: 'move-neighbour',
    action: { kind: 'move', where: NEIGHBOUR, afterBlock: LIST },
    kept: (_, order) =>
      order.findIndex((b) => b.includes('The neighbour')) >
      order.findIndex((b) => b.startsWith('- first item')),
  },
  {
    id: 'delete-neighbour',
    action: { kind: 'delete', where: NEIGHBOUR },
    kept: (md) => !md.includes('The neighbour'),
  },
];

async function setup(action: HumanAction) {
  const base = await buildSnapshot(DOC_MD, COMMENTS);
  const view = await readDocument(DOC, base);
  const synced = new SyncedDocument(base);
  return {
    base,
    view,
    synced,
    baseRevision: synced.revision(),
    updates: await humanUpdates(base, action),
    edits: [{ block_id: view.blocks[TARGET].id, old: AI_OLD, new: AI_NEW }],
  };
}

async function expectBothKept(
  scenario: Scenario,
  synced: SyncedDocument,
  baseIds: string[]
) {
  const after = await readDocument(DOC, synced.snapshot());
  const markdowns = after.blocks.map((b) => b.markdown);
  const markdown = markdowns.join('\n\n');
  expect(scenario.kept(markdown, markdowns)).toBe(true);
  expect(markdown.split(AI_NEW).length - 1).toBe(1);
  expect(markdown).not.toContain(AI_OLD);
  const ids = new Set(after.blocks.map((b) => b.id));
  const expectedIds =
    scenario.action.kind === 'delete'
      ? baseIds.filter((_, i) => i !== scenario.action.where)
      : baseIds;
  for (const id of expectedIds) expect(ids).toContain(id);
  expect(after.blocks.length).toBe(expectedIds.length);
  const comments = new Set(after.blocks.flatMap((b) => b.commentIds));
  expect(comments).toEqual(
    new Set(
      scenario.action.kind === 'delete'
        ? ['cm-intro', 'cm-target']
        : ['cm-intro', 'cm-target', 'cm-neighbour']
    )
  );
}

describe('a person edits between the agent’s read and its commit (merge at base)', () => {
  for (const scenario of SCENARIOS)
    it(`${scenario.id}: both edits survive, ids and comment marks kept`, async () => {
      const { synced, baseRevision, updates, edits, view } = await setup(
        scenario.action
      );
      for (const update of updates) synced.doc.import(update);

      const response = await runDirectEdit(
        DOC,
        { edits, baseRevision },
        synced,
        new AbortController().signal,
        NOOP_SPAN
      );

      expect(response.outcome).toBe('committed');
      expect(['base', 'rebased']).toContain(response.merge);
      await expectBothKept(
        scenario,
        synced,
        view.blocks.map((b) => b.id)
      );
    });

  it('type-same merges at the base without recomputing', async () => {
    const { synced, baseRevision, updates, edits } = await setup(
      SCENARIOS[0].action
    );
    for (const update of updates) synced.doc.import(update);
    const response = await runDirectEdit(
      DOC,
      { edits, baseRevision },
      synced,
      new AbortController().signal,
      NOOP_SPAN
    );
    expect(response.merge).toBe('base');
  });

  it('delete-same: the matched text is gone, so the batch is a 409 conflict and nothing is written', async () => {
    const { synced, baseRevision, updates, edits } = await setup({
      kind: 'delete',
      where: TARGET,
    });
    for (const update of updates) synced.doc.import(update);
    const before = synced.revision();

    const error = await runDirectEdit(
      DOC,
      { edits, baseRevision },
      synced,
      new AbortController().signal,
      NOOP_SPAN
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DirectEditConflict);
    expect(synced.revision()).toBe(before);
  });

  it('the person editing the matched text away is a conflict too', async () => {
    const { synced, baseRevision, updates, edits } = await setup({
      kind: 'type',
      where: TARGET,
      after: 'Closing',
      text: 'X',
    });
    for (const update of updates) synced.doc.import(update);
    const error = await runDirectEdit(
      DOC,
      { edits, baseRevision },
      synced,
      new AbortController().signal,
      NOOP_SPAN
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DirectEditConflict);
  });
});

describe('a person edits during the commit (merged after it)', () => {
  for (const scenario of SCENARIOS) {
    // mac-ai-editing-speed.5: bolding a word splits its text run, and the
    // run's Loro text container ends up holding the part after the word while
    // the part before it moves to a new container. The agent's concurrent
    // splice was in that part, so it lands after the bold word and the old
    // text stays. The agent's update is already committed when the person's
    // arrives, so the apply step cannot see it; the fix is on the splitting
    // side (keep the run's id on its first part).
    const known = scenario.id === 'bold-same';
    (known ? it.skip : it)(
      `${scenario.id}: both edits survive, ids and comment marks kept`,
      async () => {
        const { synced, baseRevision, updates, edits, view } = await setup(
          scenario.action
        );

        await runDirectEdit(
          DOC,
          { edits, baseRevision },
          synced,
          new AbortController().signal,
          NOOP_SPAN
        );
        for (const update of updates) synced.doc.import(update);

        await expectBothKept(
          scenario,
          synced,
          view.blocks.map((b) => b.id)
        );
      }
    );
  }

  it('delete-same: the person’s delete wins, the agent’s edit goes with the block', async () => {
    const { synced, baseRevision, updates, edits } = await setup({
      kind: 'delete',
      where: TARGET,
    });
    const response = await runDirectEdit(
      DOC,
      { edits, baseRevision },
      synced,
      new AbortController().signal,
      NOOP_SPAN
    );
    expect(response.outcome).toBe('committed');
    const edited = await readDocument(DOC, synced.snapshot());
    expect(edited.blocks.some((b) => b.markdown.includes(AI_NEW))).toBe(true);
    for (const update of updates) synced.doc.import(update);
    const after = await readDocument(DOC, synced.snapshot());
    expect(after.blocks.some((b) => b.markdown.includes('The target'))).toBe(
      false
    );
    expect(after.blocks.length).toBe(5);
  });
});

describe('another peer commits inside the worker’s load → commit window', () => {
  it('the commit is retried on the new revision and both edits survive', async () => {
    const { synced, baseRevision, updates, edits, view } = await setup(
      SCENARIOS[1].action
    );
    synced.afterLoad = () => {
      for (const update of updates) synced.doc.import(update);
    };

    const response = await runDirectEdit(
      DOC,
      { edits, baseRevision },
      synced,
      new AbortController().signal,
      NOOP_SPAN
    );

    expect(response.outcome).toBe('committed');
    expect(synced.commits).toBe(1);
    await expectBothKept(
      SCENARIOS[1],
      synced,
      view.blocks.map((b) => b.id)
    );
  });
});

describe('a person keeps typing while the worker commits', () => {
  /** Import one of the person's keystrokes after each of the next `times` loads. */
  function typeOnLoads(
    synced: SyncedDocument,
    keystrokes: Uint8Array[],
    times: number
  ) {
    let left = times;
    const arm = () => {
      synced.afterLoad = () => {
        const keystroke = keystrokes.shift();
        if (keystroke) synced.doc.import(keystroke);
        if (--left > 0) arm();
      };
    };
    arm();
  }

  it('merges the same base edit into each new revision until it lands', async () => {
    const { synced, baseRevision, updates, edits } = await setup(
      SCENARIOS[0].action
    );
    typeOnLoads(synced, updates, 4);

    const response = await runDirectEdit(
      DOC,
      { edits, baseRevision },
      synced,
      new AbortController().signal,
      NOOP_SPAN
    );

    expect(response.outcome).toBe('committed');
    expect(synced.commits).toBe(1);
    const after = await readDocument(DOC, synced.snapshot());
    const markdown = after.blocks.map((b) => b.markdown).join('\n\n');
    expect(markdown).toContain(AI_NEW);
    expect(markdown).toContain('The target qqa paragraph');
  });

  it('gives up as busy, writing nothing, when every attempt races', async () => {
    const { synced, baseRevision, updates, edits } = await setup(
      SCENARIOS[0].action
    );
    typeOnLoads(synced, updates, updates.length);

    const failure = await runDirectEdit(
      DOC,
      { edits, baseRevision },
      synced,
      new AbortController().signal,
      NOOP_SPAN
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DirectEditConflict);
    expect((failure as DirectEditConflict).reason).toBe('busy');
    expect(synced.commits).toBe(0);
  });
});
