import { LoroManager } from '@macro-inc/collaboration/collab/manager';
import {
  createNoopLiveSyncSource,
  type LiveSyncSource,
  type SyncSourceEvent,
} from '@macro-inc/collaboration/collab/source';
import { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import { markdownToLoroSnapshot } from '@macro-inc/lexical-core/markdown-loro-snapshot';
import {
  LoroDoc,
  type LoroMap,
  type LoroMovableList,
  type LoroText,
  VersionVector,
} from 'loro-crdt';
import { okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import type { SerializedNode } from './normalize';
import {
  applyLexicalCommit,
  commitLexical,
  currentState,
  type LexicalState,
  readLexicalState,
  UnacknowledgedError,
} from './run';
import type { LexicalBlock } from './wanted';

const DOC = 'doc-1';
const MARKDOWN = 'Ship in Q3.\n\n## Later\n\n```js\nconst a = 1;\n```';

async function worker(snapshot: Uint8Array) {
  const manager = new LoroManager(MARKDOWN_LORO_SCHEMA, { documentId: DOC });
  (await manager.initializeFromSnapshot(snapshot))._unsafeUnwrap();
  return manager;
}

function human(snapshot: Uint8Array): LoroDoc {
  const doc = new LoroDoc();
  doc.import(snapshot);
  return doc;
}

function exchange(a: LoroDoc, b: LoroDoc) {
  const fromA = a.export({ mode: 'update', from: b.oplogVersion() });
  const fromB = b.export({ mode: 'update', from: a.oplogVersion() });
  a.import(fromB);
  b.import(fromA);
}

/** The LoroText at `path` (child indexes from the root), as a typist edits it. */
function loroText(doc: LoroDoc, path: number[]): LoroText {
  let node = doc.getMap('root');
  for (const index of path)
    node = (node.get('children') as LoroMovableList).get(index) as LoroMap;
  return node.get('text') as LoroText;
}

type Node = { text?: string; children?: Node[] };

function textOf(node: Node): string {
  return (node.text ?? '') + (node.children ?? []).map(textOf).join('|');
}

/** Each top-level block's text, from a peer's Loro doc. */
function blockTexts(doc: LoroDoc): string[] {
  const root = (doc.toJSON() as { root: Node }).root;
  return (root.children ?? []).map(textOf);
}

/** The node at `path` in a normalized state. */
function at(read: LexicalState, path: number[]): SerializedNode {
  let node = read.state.root;
  for (const index of path) node = node.children![index]!;
  return node;
}

/** A copy of top-level block `index` with the text at `textPath` replaced, sent in place. */
function edited(
  read: LexicalState,
  index: number,
  textPath: number[],
  value: string
): LexicalBlock {
  const node = structuredClone(at(read, [index]));
  let target = node;
  for (const step of textPath) target = target.children![step]!;
  target.text = value;
  const previous = index === 0 ? null : at(read, [index - 1]);
  return {
    id: node.$!.id as string,
    after: previous ? (previous.$!.id as string) : null,
    node,
  };
}

/**
 * `value` with its revision decoded into sorted version entries: one version
 * encodes with its entries in varying order.
 */
function comparable<Value extends { revision: string }>(value: Value) {
  const version = VersionVector.decode(
    Uint8Array.from(atob(value.revision), (c) => c.charCodeAt(0))
  ).toJSON();
  return {
    ...value,
    revision: [...version].sort(([left], [right]) => left.localeCompare(right)),
  };
}

/** A sync service that records what reached it and can deliver remote updates. */
function syncService(snapshot: Uint8Array) {
  const server = new LoroDoc();
  server.import(snapshot);
  const listeners = new Set<(event: SyncSourceEvent) => void>();
  let acknowledge = true;
  let beforeAcknowledge: (() => void) | undefined;
  const source: LiveSyncSource = {
    ...createNoopLiveSyncSource(DOC),
    listen: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    pushUpdate: async (updates) => {
      if (!acknowledge) return false;
      for (const update of updates) server.import(update);
      beforeAcknowledge?.();
      beforeAcknowledge = undefined;
      return true;
    },
  };
  return {
    source,
    server,
    deliver: (update: Uint8Array) => {
      for (const listener of listeners) listener({ type: 'update', update });
    },
    stopAcknowledging: () => {
      acknowledge = false;
    },
    /** Run `action` once, as the first push reaches the server. */
    onFirstPush: (action: () => void) => {
      beforeAcknowledge = action;
    },
  };
}

describe('applyLexicalCommit', () => {
  it('applies the commit and reaches other peers', async () => {
    const snapshot = (await markdownToLoroSnapshot(MARKDOWN))!;
    const manager = await worker(snapshot);
    const peer = human(snapshot);
    const read = currentState(manager);
    const paragraph = edited(read, 0, [0], 'Ship in Q4.');
    const inserted: LexicalBlock = {
      id: 'next-steps',
      after: at(read, [1]).$!.id as string,
      node: {
        type: 'paragraph',
        children: [
          {
            type: 'text',
            text: 'Next',
            detail: 0,
            format: 0,
            mode: 'normal',
            style: '',
            version: 1,
            $: { id: 'next-steps-text' },
          },
        ],
        direction: null,
        format: '',
        indent: 0,
        textFormat: 0,
        textStyle: '',
        version: 1,
        $: { id: 'next-steps' },
      },
    };

    const outcome = await applyLexicalCommit(
      manager,
      createNoopLiveSyncSource(DOC),
      { revision: read.revision, blocks: [paragraph, inserted], removed: [] }
    );

    exchange(manager.doc, peer);
    expect(blockTexts(peer)).toEqual([
      'Ship in Q4.',
      'Later',
      'Next',
      'const a = 1;',
    ]);
    if (outcome.kind !== 'committed') throw new Error(outcome.kind);
    expect(comparable(outcome)).toEqual(
      comparable({ kind: 'committed', applied: true, ...currentState(manager) })
    );
    expect(
      VersionVector.decode(
        Uint8Array.from(atob(outcome.revision), (c) => c.charCodeAt(0))
      ).compare(peer.oplogVersion())
    ).toBe(0);
    manager.dispose();
  });

  it('merges a collaborator typing in another block before and during the commit', async () => {
    const snapshot = (await markdownToLoroSnapshot(MARKDOWN))!;
    const manager = await worker(snapshot);
    const peer = human(snapshot);
    const read = currentState(manager);

    // Typed after the program read and synced before it commits.
    loroText(peer, [1, 0]).insert('Later'.length, ' on');
    peer.commit();
    exchange(manager.doc, peer);
    // Typed while the commit runs, reaching the worker only afterwards.
    loroText(peer, [1, 0]).insert(0, 'Much ');
    peer.commit();

    const outcome = await applyLexicalCommit(
      manager,
      createNoopLiveSyncSource(DOC),
      {
        revision: read.revision,
        blocks: [edited(read, 0, [0], 'Ship in Q4.')],
        removed: [],
      }
    );
    expect(outcome).toMatchObject({ kind: 'committed', applied: true });

    exchange(manager.doc, peer);
    expect(manager.doc.toJSON()).toEqual(peer.toJSON());
    expect(blockTexts(peer)).toEqual([
      'Ship in Q4.',
      'Much Later on',
      'const a = 1;',
    ]);
    manager.dispose();
  });

  it('merges typing in the same block that reaches the worker after the commit', async () => {
    const snapshot = (await markdownToLoroSnapshot(MARKDOWN))!;
    const manager = await worker(snapshot);
    const peer = human(snapshot);
    const read = currentState(manager);

    loroText(peer, [0, 0]).insert(0, 'We ');
    peer.commit();

    const outcome = await applyLexicalCommit(
      manager,
      createNoopLiveSyncSource(DOC),
      {
        revision: read.revision,
        blocks: [edited(read, 0, [0], 'Ship in Q4.')],
        removed: [],
      }
    );
    expect(outcome).toMatchObject({ kind: 'committed', applied: true });

    exchange(manager.doc, peer);
    expect(manager.doc.toJSON()).toEqual(peer.toJSON());
    expect(blockTexts(peer)[0]).toBe('We Ship in Q4.');
    manager.dispose();
  });

  it('merges typing that arrives while the commit is being acknowledged', async () => {
    const snapshot = (await markdownToLoroSnapshot(MARKDOWN))!;
    const manager = await worker(snapshot);
    const peer = human(snapshot);
    const sync = syncService(snapshot);
    const read = currentState(manager);

    loroText(peer, [1, 0]).insert(0, 'Much ');
    peer.commit();
    sync.onFirstPush(() =>
      sync.deliver(
        peer.export({ mode: 'update', from: manager.doc.oplogVersion() })
      )
    );

    const outcome = await applyLexicalCommit(manager, sync.source, {
      revision: read.revision,
      blocks: [edited(read, 0, [0], 'Ship in Q4.')],
      removed: [],
    });
    expect(outcome).toMatchObject({ kind: 'committed', applied: true });

    exchange(manager.doc, peer);
    exchange(sync.server, peer);
    expect(blockTexts(peer)).toEqual([
      'Ship in Q4.',
      'Much Later',
      'const a = 1;',
    ]);
    expect(manager.doc.toJSON()).toEqual(peer.toJSON());
    manager.dispose();
  });

  it('conflicts, applying nothing, when a collaborator changed the same block first', async () => {
    const snapshot = (await markdownToLoroSnapshot(MARKDOWN))!;
    const manager = await worker(snapshot);
    const peer = human(snapshot);
    const read = currentState(manager);
    loroText(peer, [0, 0]).insert(0, 'We ');
    peer.commit();
    exchange(manager.doc, peer);
    const before = manager.doc.oplogVersion();

    const outcome = await applyLexicalCommit(
      manager,
      createNoopLiveSyncSource(DOC),
      {
        revision: read.revision,
        blocks: [edited(read, 0, [0], 'Ship in Q4.')],
        removed: [],
      }
    );

    expect(outcome).toEqual({
      kind: 'conflict',
      conflicts: [{ id: at(read, [0]).$!.id, reason: 'changed' }],
    });
    expect(manager.doc.oplogVersion().compare(before)).toBe(0);
    manager.dispose();
  });

  it('applies nothing when retrying a commit that landed', async () => {
    const snapshot = (await markdownToLoroSnapshot(MARKDOWN))!;
    const manager = await worker(snapshot);
    const read = currentState(manager);
    const commit = {
      revision: read.revision,
      blocks: [edited(read, 0, [0], 'Ship in Q4.')],
      removed: [at(read, [1]).$!.id as string],
    };
    const first = await applyLexicalCommit(
      manager,
      createNoopLiveSyncSource(DOC),
      commit
    );
    const landed = manager.doc.oplogVersion();

    const retry = await applyLexicalCommit(
      manager,
      createNoopLiveSyncSource(DOC),
      commit
    );

    if (first.kind !== 'committed' || retry.kind !== 'committed')
      throw new Error('expected both to commit');
    expect(comparable(retry)).toEqual(comparable({ ...first, applied: false }));
    expect(manager.doc.oplogVersion().compare(landed)).toBe(0);
    manager.dispose();
  });

  it('applies nothing when a commit changes nothing', async () => {
    const snapshot = (await markdownToLoroSnapshot(MARKDOWN))!;
    const manager = await worker(snapshot);
    const read = currentState(manager);
    const before = manager.doc.oplogVersion();

    const outcome = await applyLexicalCommit(
      manager,
      createNoopLiveSyncSource(DOC),
      {
        revision: read.revision,
        blocks: [0, 1, 2].map((index) =>
          edited(read, index, [0], at(read, [index, 0]).text as string)
        ),
        removed: [],
      }
    );

    if (outcome.kind !== 'committed') throw new Error(outcome.kind);
    expect(comparable(outcome)).toEqual(
      comparable({ kind: 'committed', applied: false, ...read })
    );
    expect(manager.doc.oplogVersion().compare(before)).toBe(0);
    manager.dispose();
  });

  it('applies nothing when the request aborts before the apply', async () => {
    const snapshot = (await markdownToLoroSnapshot(MARKDOWN))!;
    const manager = await worker(snapshot);
    const read = currentState(manager);
    const before = manager.doc.oplogVersion();
    const controller = new AbortController();
    controller.abort();

    await expect(
      applyLexicalCommit(
        manager,
        createNoopLiveSyncSource(DOC),
        {
          revision: read.revision,
          blocks: [edited(read, 0, [0], 'Ship in Q4.')],
          removed: [],
        },
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(manager.doc.oplogVersion().compare(before)).toBe(0);
    manager.dispose();
  });

  it('throws when the sync service does not acknowledge the commit', async () => {
    const snapshot = (await markdownToLoroSnapshot(MARKDOWN))!;
    const manager = await worker(snapshot);
    const sync = syncService(snapshot);
    sync.stopAcknowledging();
    const read = currentState(manager);

    await expect(
      applyLexicalCommit(manager, sync.source, {
        revision: read.revision,
        blocks: [edited(read, 0, [0], 'Ship in Q4.')],
        removed: [],
      })
    ).rejects.toBeInstanceOf(UnacknowledgedError);
    manager.dispose();
  });

  it.each([
    ['is not base64', '%%%'],
    [
      'is a version of another document',
      (() => {
        const other = new LoroDoc();
        other.getText('t').insert(0, 'x');
        other.commit();
        return btoa(String.fromCharCode(...other.oplogVersion().encode()));
      })(),
    ],
  ])('conflicts on a revision that %s', async (_, revision) => {
    const snapshot = (await markdownToLoroSnapshot(MARKDOWN))!;
    const manager = await worker(snapshot);
    const read = currentState(manager);

    const outcome = await applyLexicalCommit(
      manager,
      createNoopLiveSyncSource(DOC),
      { revision, blocks: [edited(read, 0, [0], 'x')], removed: [] }
    );

    expect(outcome).toEqual({
      kind: 'conflict',
      conflicts: [{ id: null, reason: 'revision' }],
    });
    manager.dispose();
  });

  it('refuses an unknown node type and duplicate ids', async () => {
    const snapshot = (await markdownToLoroSnapshot(MARKDOWN))!;
    const manager = await worker(snapshot);
    const read = currentState(manager);
    const paragraph = edited(read, 0, [0], 'x');

    const unknown = await applyLexicalCommit(
      manager,
      createNoopLiveSyncSource(DOC),
      {
        revision: read.revision,
        blocks: [
          {
            ...paragraph,
            node: { ...(paragraph.node as SerializedNode), type: 'nope' },
          },
        ],
        removed: [],
      }
    );
    const duplicate = await applyLexicalCommit(
      manager,
      createNoopLiveSyncSource(DOC),
      {
        revision: read.revision,
        blocks: [
          {
            ...paragraph,
            node: {
              ...(paragraph.node as SerializedNode),
              children: [at(read, [1, 0])],
            },
          },
        ],
        removed: [],
      }
    );

    expect(unknown).toEqual({
      kind: 'invalid',
      message: expect.stringContaining('nope'),
    });
    expect(duplicate).toEqual({
      kind: 'invalid',
      message: expect.stringContaining(at(read, [1, 0]).$!.id as string),
    });
    manager.dispose();
  });

  it('merges edits by both sides to different items of a nested list', async () => {
    const snapshot = (await markdownToLoroSnapshot('- a\n- b\n  - c\n  - d'))!;
    const manager = await worker(snapshot);
    const peer = human(snapshot);
    const read = currentState(manager);
    // list > holder (item 2) > nested list > item c / d > text
    loroText(peer, [0, 2, 0, 0, 0]).insert(1, ' by human');
    peer.commit();
    exchange(manager.doc, peer);

    const outcome = await applyLexicalCommit(
      manager,
      createNoopLiveSyncSource(DOC),
      {
        revision: read.revision,
        blocks: [edited(read, 0, [2, 0, 1, 0], 'd by program')],
        removed: [],
      }
    );
    expect(outcome).toMatchObject({ kind: 'committed', applied: true });

    exchange(manager.doc, peer);
    expect(blockTexts(peer)).toEqual(['a|b|c by human|d by program']);
    manager.dispose();
  });

  it('merges edits to different table cells and conflicts on the same cell', async () => {
    const snapshot = (await markdownToLoroSnapshot(
      '| x | y |\n|---|---|\n| 1 | 2 |'
    ))!;
    const manager = await worker(snapshot);
    const peer = human(snapshot);
    const read = currentState(manager);
    // table > row 1 > cell 0 > paragraph > text
    loroText(peer, [0, 1, 0, 0, 0]).insert(1, ' by human');
    peer.commit();
    exchange(manager.doc, peer);

    const sameCell = await applyLexicalCommit(
      manager,
      createNoopLiveSyncSource(DOC),
      {
        revision: read.revision,
        blocks: [edited(read, 0, [1, 0, 0, 0], '1 by program')],
        removed: [],
      }
    );
    const otherCell = await applyLexicalCommit(
      manager,
      createNoopLiveSyncSource(DOC),
      {
        revision: read.revision,
        blocks: [edited(read, 0, [1, 1, 0, 0], '2 by program')],
        removed: [],
      }
    );

    expect(sameCell).toEqual({
      kind: 'conflict',
      conflicts: [{ id: at(read, [0, 1, 0, 0]).$!.id, reason: 'changed' }],
    });
    expect(otherCell).toMatchObject({ kind: 'committed', applied: true });
    exchange(manager.doc, peer);
    expect(blockTexts(peer)).toEqual(['x|y|1 by human|2 by program']);
    manager.dispose();
  });
});

describe('readLexicalState and commitLexical', () => {
  it('read a document and commit to it as a named editor over a fresh connection each', async () => {
    const snapshot = (await markdownToLoroSnapshot(MARKDOWN))!;
    const sync = syncService(snapshot);
    const connect = () => ({
      ...sync.source,
      doInitialSync: () =>
        okAsync({
          snapshot: sync.server.export({ mode: 'snapshot' }),
          awareness: new Uint8Array(),
        }),
    });

    const read = await readLexicalState(connect(), DOC);
    const outcome = await commitLexical(
      connect(),
      DOC,
      {
        revision: read.revision,
        blocks: [edited(read, 0, [0], 'Ship in Q4.')],
        removed: [],
      },
      { editor: { name: 'Macro' } }
    );

    expect(outcome).toMatchObject({ kind: 'committed', applied: true });
    expect(blockTexts(sync.server)[0]).toBe('Ship in Q4.');
    if (outcome.kind !== 'committed') throw new Error(outcome.kind);
    expect(comparable(await readLexicalState(connect(), DOC))).toEqual(
      comparable({ state: outcome.state, revision: outcome.revision })
    );
  });
});
