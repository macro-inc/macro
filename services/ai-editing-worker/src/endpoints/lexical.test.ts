import { markdownToLoroSnapshot } from '@macro-inc/lexical-core/markdown-loro-snapshot';
import { Hono } from 'hono';
import {
  LoroDoc,
  type LoroMap,
  type LoroMovableList,
  type LoroText,
  VersionVector,
} from 'loro-crdt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  SerializedNode,
  SerializedState,
} from '../lexical-commit/normalize';

const sync = vi.hoisted(() => ({
  server: undefined as LoroDoc | undefined,
  acknowledge: true,
  initialSyncFails: false,
  urls: [] as string[],
}));

vi.mock('../sources', async (original) => {
  const { createNoopLiveSyncSource } = await import(
    '@macro-inc/collaboration/collab/source'
  );
  const { errAsync, okAsync } = await import('neverthrow');
  return {
    ...(await original<typeof import('../sources')>()),
    createWorkerSyncSource: (url: string, documentId: string) => {
      sync.urls.push(url);
      const server = sync.server!;
      return {
        ...createNoopLiveSyncSource(documentId),
        doInitialSync: () =>
          sync.initialSyncFails
            ? errAsync({ type: 'timeout', duration: 5 })
            : okAsync({
                snapshot: server.export({ mode: 'snapshot' }),
                awareness: new Uint8Array(),
              }),
        pushUpdate: async (updates: Uint8Array[]) => {
          if (!sync.acknowledge) return false;
          for (const update of updates) server.import(update);
          return true;
        },
      };
    },
  };
});
vi.mock('../env', () => ({
  getEnv: () => ({ SYNC_WS_BASE: 'wss://sync.test' }),
}));

const { default: lexicalState } = await import('./lexical-state');
const { default: lexicalCommit } = await import('./lexical-commit');
const endpoints = new Hono()
  .route('/lexical-state', lexicalState)
  .route('/lexical-commit', lexicalCommit);

/** An unsigned token claiming `access_level`; the sync service checks signatures. */
const token = (access_level: string) =>
  [
    'header',
    btoa(JSON.stringify({ access_level })).replace(/=+$/, ''),
    'sig',
  ].join('.');

const post = (path: string, body: unknown, signal?: AbortSignal) =>
  endpoints.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

type Read = { state: SerializedState; revision: string };

async function read(): Promise<Read> {
  const response = await post('/lexical-state', {
    documentId: 'doc',
    documentToken: token('view'),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as Read;
}

const commit = (body: Record<string, unknown>, signal?: AbortSignal) =>
  post(
    '/lexical-commit',
    { documentId: 'doc', documentToken: token('edit'), removed: [], ...body },
    signal
  );

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

/** Top-level block `index` of `state` with its first text replaced, sent in place. */
function edited(state: SerializedState, index: number, value: string) {
  const node = structuredClone(state.root.children![index]!);
  node.children![0]!.text = value;
  return {
    id: node.$!.id as string,
    after:
      index === 0 ? null : (state.root.children![index - 1]!.$!.id as string),
    node,
  };
}

/** The first text of top-level block `index`, as a typist edits it. */
function typed(doc: LoroDoc, index: number): LoroText {
  const block = (doc.getMap('root').get('children') as LoroMovableList).get(
    index
  ) as LoroMap;
  const text = (block.get('children') as LoroMovableList).get(0) as LoroMap;
  return text.get('text') as LoroText;
}

type Node = { text?: string; children?: Node[] };

function textOf(node: Node): string {
  return (node.text ?? '') + (node.children ?? []).map(textOf).join('|');
}

function serverTexts(): string[] {
  const root = (sync.server!.toJSON() as { root: Node }).root;
  return (root.children ?? []).map(textOf);
}

describe('POST /lexical-state', () => {
  beforeEach(async () => {
    sync.server = new LoroDoc();
    sync.server.import(
      (await markdownToLoroSnapshot('Ship in Q3.\n\n## Later'))!
    );
    sync.acknowledge = true;
    sync.initialSyncFails = false;
    sync.urls.length = 0;
  });

  it('answers the normalized state and its revision', async () => {
    const { state, revision } = await read();
    expect(state.root.children!.map((node) => node.type)).toEqual([
      'paragraph',
      'heading',
    ]);
    expect(
      VersionVector.decode(
        Uint8Array.from(atob(revision), (c) => c.charCodeAt(0))
      ).compare(sync.server!.oplogVersion())
    ).toBe(0);
    expect(sync.urls).toEqual([
      `wss://sync.test/document/doc/connect?token=${token('view')}`,
    ]);
  });

  it('answers 400 for a malformed body', async () => {
    const response = await post('/lexical-state', { documentId: 'doc' });
    expect(response.status).toBe(400);
  });

  it('answers 502 when the initial sync fails', async () => {
    sync.initialSyncFails = true;
    const response = await post('/lexical-state', {
      documentId: 'doc',
      documentToken: token('view'),
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'sync_failed',
      message: expect.stringContaining('timeout'),
    });
  });
});

describe('POST /lexical-commit', () => {
  beforeEach(async () => {
    sync.server = new LoroDoc();
    sync.server.import(
      (await markdownToLoroSnapshot('Ship in Q3.\n\n## Later'))!
    );
    sync.acknowledge = true;
    sync.initialSyncFails = false;
    sync.urls.length = 0;
  });

  it('merges the commit with typing in another block and answers the merged state', async () => {
    const { state, revision } = await read();
    typed(sync.server!, 1).insert('Later'.length, ' on');
    sync.server!.commit();

    const response = await commit({
      revision,
      blocks: [edited(state, 0, 'Ship in Q4.')],
      editor: { name: 'Macro' },
    });

    expect(response.status).toBe(200);
    expect(serverTexts()).toEqual(['Ship in Q4.', 'Later on']);
    expect(comparable((await response.json()) as Read)).toEqual(
      comparable(await read())
    );
  });

  it('answers the same 200 and applies nothing when a landed commit is retried', async () => {
    const { state, revision } = await read();
    const body = { revision, blocks: [edited(state, 0, 'Ship in Q4.')] };
    const first = await commit(body);
    const landed = sync.server!.oplogVersion();

    const retry = await commit(body);

    expect(retry.status).toBe(200);
    expect(comparable((await retry.json()) as Read)).toEqual(
      comparable((await first.json()) as Read)
    );
    expect(sync.server!.oplogVersion().compare(landed)).toBe(0);
  });

  it('answers 409 when someone changed the same block since the revision', async () => {
    const { state, revision } = await read();
    typed(sync.server!, 0).insert(0, 'We ');
    sync.server!.commit();

    const response = await commit({
      revision,
      blocks: [edited(state, 0, 'Ship in Q4.')],
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'conflict',
      conflicts: [{ id: state.root.children![0]!.$!.id, reason: 'changed' }],
    });
    expect(serverTexts()).toEqual(['We Ship in Q3.', 'Later']);
  });

  it("answers 409 with reason 'revision' for a revision it cannot decode", async () => {
    const { state } = await read();
    const response = await commit({
      revision: 'not a revision',
      blocks: [edited(state, 0, 'Ship in Q4.')],
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'conflict',
      conflicts: [{ id: null, reason: 'revision' }],
    });
  });

  it.each([
    [
      'an unknown node type',
      (state: SerializedState) => {
        const block = edited(state, 0, 'x');
        return [{ ...block, node: { ...block.node, type: 'nope' } }];
      },
      'nope',
    ],
    [
      'duplicate ids',
      (state: SerializedState) => {
        const block = edited(state, 0, 'x');
        const node: SerializedNode = {
          ...block.node,
          children: [state.root.children![1]!.children![0]!],
        };
        return [{ ...block, node }];
      },
      'more than once',
    ],
    [
      'more than 500 blocks',
      (state: SerializedState) =>
        Array.from({ length: 501 }, (_, index) => ({
          ...edited(state, 0, 'x'),
          id: `block-${index}`,
        })),
      'at most 500',
    ],
  ])('answers 422 for %s and applies nothing', async (_, blocks, message) => {
    const { state, revision } = await read();
    const before = sync.server!.oplogVersion();

    const response = await commit({ revision, blocks: blocks(state) });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: 'invalid',
      message: expect.stringContaining(message),
    });
    expect(sync.server!.oplogVersion().compare(before)).toBe(0);
  });

  it('answers 400 for a malformed body', async () => {
    const response = await commit({ blocks: [] });
    expect(response.status).toBe(400);
  });

  it.each(['view', 'comment'])('refuses a %s token', async (level) => {
    const response = await post('/lexical-commit', {
      documentId: 'doc',
      documentToken: token(level),
      revision: 'AA==',
      blocks: [],
      removed: [],
    });
    expect(response.status).toBe(403);
    expect(sync.urls).toEqual([]);
  });

  it('answers 502 when the sync service does not acknowledge the commit', async () => {
    const { state, revision } = await read();
    sync.acknowledge = false;

    const response = await commit({
      revision,
      blocks: [edited(state, 0, 'Ship in Q4.')],
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'unacknowledged',
      message: expect.stringContaining('did not acknowledge'),
    });
  });

  it('answers 499 and applies nothing when the request aborted before the apply', async () => {
    const { state, revision } = await read();
    const before = sync.server!.oplogVersion();
    const controller = new AbortController();
    controller.abort();

    const response = await commit(
      { revision, blocks: [edited(state, 0, 'Ship in Q4.')] },
      controller.signal
    );

    expect(response.status).toBe(499);
    expect(sync.server!.oplogVersion().compare(before)).toBe(0);
  });
});
