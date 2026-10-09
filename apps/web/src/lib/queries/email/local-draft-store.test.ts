import { Blob as NodeBlob } from 'node:buffer';
import 'fake-indexeddb/auto';
import type { LocalDraft } from '@app/features/email-compose/core/local-draft';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalDraftStore } from './local-draft-store';

const stores: ReturnType<typeof createLocalDraftStore>[] = [];
const open = (name = crypto.randomUUID()) => {
  const store = createLocalDraftStore(name);
  stores.push(store);
  return store;
};
const snapshot = (
  subject = 'Keep this draft',
  expectedRevision = 0
): Omit<LocalDraft, 'revision' | 'acknowledgedRevision' | 'updatedAt'> & {
  expectedRevision: number;
} => ({
  expectedRevision,
  key: 'local',
  accountId: 'owner',
  generation: 'generation',
  draftId: 'local',
  threadId: 'thread',
  content: { subject },
  attachments: [],
  status: 'dirty',
});
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('durable email working copies', () => {
  it('retains rejected content and further edits across reopening', async () => {
    const name = crypto.randomUUID();
    const first = open(name);
    const session = await first.activate('owner');
    await first.save(session, snapshot());
    await first.update(session, 'local', (draft) => ({
      ...draft,
      status: 'failed',
      errorCode: 'INTERNAL',
    }));
    await first.save(session, snapshot('Edited after rejection', 1));
    await first.close();
    const second = open(name);
    expect(
      await second.read(await second.activate('owner'), 'local')
    ).toMatchObject({
      revision: 2,
      status: 'failed',
      content: { subject: 'Edited after rejection' },
    });
  });
  it('commits file bytes with their references and restores them after reopening', async () => {
    const name = crypto.randomUUID();
    const first = open(name);
    const owner = await first.activate('owner');
    const draft = snapshot();
    draft.attachments = [
      {
        type: 'local',
        id: 'file',
        name: 'note.txt',
        mimeType: 'text/plain',
        size: 5,
        lastModified: 0,
        uploaded: false,
      },
    ];
    await first.save(
      owner,
      draft,
      new Map([['file', new NodeBlob(['hello']) as unknown as Blob]])
    );
    await first.close();
    const second = open(name);
    const session = await second.activate('owner');
    expect(await (await second.file(session, 'local', 'file'))?.text()).toBe(
      'hello'
    );
    await second.save(session, snapshot('Keep this draft', 1));
    expect(await second.file(session, 'local', 'file')).toBeUndefined();
  });
  it('rejects stale snapshots inside the transaction across tabs', async () => {
    const name = crypto.randomUUID();
    const first = open(name);
    const second = open(name);
    const owner = await first.activate('owner');
    await second.activate('owner');
    await first.save(owner, snapshot('Original'));
    const stale = snapshot('Slow older edit', 1);
    await second.save(owner, snapshot('Newer edit', 1));
    await expect(
      first.save(
        owner,
        stale,
        new Map([['stale-file', new NodeBlob(['stale']) as unknown as Blob]])
      )
    ).rejects.toThrow('changed while saving');
    expect(await first.read(owner, 'local')).toMatchObject({
      revision: 2,
      content: { subject: 'Newer edit' },
    });
    expect(await first.file(owner, 'local', 'stale-file')).toBeUndefined();
    await first.save(owner, snapshot('Edit based on latest', 2));
    expect((await second.read(owner, 'local'))?.revision).toBe(3);
  });
  it('fences callbacks after discard and account changes', async () => {
    const store = open();
    const owner = await store.activate('owner');
    await store.save(owner, snapshot());
    await store.update(owner, 'local', () => undefined);
    await expect(store.save(owner, snapshot('late edit'))).rejects.toThrow(
      'no longer active'
    );
    await expect(store.activate('another-owner')).rejects.toThrow();
    await store.clear();
    await store.activate('another-owner');
    await expect(store.save(owner, snapshot())).rejects.toThrow(
      'no longer active'
    );
    expect(await store.list(owner)).toEqual([]);
  });
  it('does not notify subscribers from reads or session activation', async () => {
    const store = open();
    const owner = await store.activate('owner');
    let notifications = 0;
    const stop = store.subscribe(() => notifications++);
    await store.activate('owner');
    await store.list(owner);
    await store.read(owner, 'local');
    expect(notifications).toBe(0);
    await store.save(owner, snapshot());
    expect(notifications).toBe(1);
    stop();
  });
});

describe('working-copy concurrency fences', () => {
  it('does not let a stale tab activate a prior session after logout', async () => {
    const store = open();
    const owner = await store.activate('owner', 'new-epoch');
    await store.save(owner, snapshot());
    await expect(
      store.activate('owner', 'old-epoch', () => false)
    ).rejects.toThrow();
    await expect(store.activate('other-owner', 'new-epoch')).rejects.toThrow();
    expect(await store.list(owner)).toHaveLength(1);
  });
  it('does not let a delayed logout wipe the next account session', async () => {
    const store = open();
    await store.activate('old-owner', 'old-epoch');
    const next = await store.activate('owner', 'new-epoch');
    await store.save(next, snapshot());
    await store.clear(true, 'old-epoch');
    expect(await store.list(next)).toHaveLength(1);
  });
  it('retires the old epoch even if logout cannot rotate localStorage', async () => {
    const store = open();
    const owner = await store.activate('owner', 'old-epoch');
    await store.save(owner, snapshot());
    await store.clear(true);
    await expect(store.activate('owner', 'old-epoch')).rejects.toThrow();
    expect(
      await store.list(await store.activate('owner', 'new-epoch'))
    ).toEqual([]);
  });
  it('merges upload receipts committed after a snapshot was captured', async () => {
    const store = open();
    const owner = await store.activate('owner');
    const input = snapshot();
    input.attachments = [
      {
        type: 'local',
        id: 'file',
        name: 'file',
        mimeType: '',
        size: 0,
        lastModified: 0,
        uploaded: false,
      },
    ];
    await store.save(owner, input);
    await store.update(owner, 'local', (draft) => ({
      ...draft,
      attachments: [
        { ...input.attachments[0], attachmentId: 'uploaded', uploaded: true },
      ],
    }));
    await store.save(owner, { ...input, expectedRevision: 1 });
    expect((await store.read(owner, 'local'))?.attachments[0]).toMatchObject({
      attachmentId: 'uploaded',
      uploaded: true,
    });
  });
  it('repairs a failed receipt journal from completed in-memory upload', async () => {
    const store = open();
    const owner = await store.activate('owner');
    const input = snapshot();
    input.attachments = [
      {
        type: 'local',
        id: 'file',
        name: 'file',
        mimeType: '',
        size: 0,
        lastModified: 0,
        attachmentId: 'uploaded',
        uploaded: false,
      },
    ];
    await store.save(owner, input);
    if (input.attachments[0].type !== 'local')
      throw new Error('Expected local fixture');
    input.attachments[0] = { ...input.attachments[0], uploaded: true };
    await store.save(owner, { ...input, expectedRevision: 1 });
    expect((await store.read(owner, 'local'))?.attachments[0]).toMatchObject({
      attachmentId: 'uploaded',
      uploaded: true,
    });
  });
  it('explicit undo uses a new generation without admitting late pre-send writes', async () => {
    const store = open();
    const owner = await store.activate('owner');
    const original = {
      ...snapshot(),
      generation: await store.generation(owner, 'local'),
    };
    await store.save(owner, original);
    await store.update(owner, 'local', () => undefined);
    const generation = await store.generation(owner, 'local', true);
    await store.save(owner, {
      ...original,
      generation,
      content: { subject: 'Undo' },
    });
    await expect(store.save(owner, original)).rejects.toThrow();
    expect((await store.read(owner, 'local'))?.content.subject).toBe('Undo');
  });
  it('retires a server alias and removes attachment bytes across tabs on discard', async () => {
    const name = crypto.randomUUID();
    const first = open(name);
    const second = open(name);
    const owner = await first.activate('owner');
    await second.activate('owner');
    // Another tab began a save through the server ID before discard.
    const aliasGeneration = await second.generation(owner, 'server');
    const original = {
      ...snapshot(),
      serverDraftId: 'server',
      attachments: [
        {
          type: 'local' as const,
          id: 'file',
          name: 'note.txt',
          mimeType: 'text/plain',
          size: 5,
          lastModified: 0,
          uploaded: false,
        },
      ],
    };
    await first.save(
      owner,
      original,
      new Map([['file', new NodeBlob(['hello']) as unknown as Blob]])
    );
    await first.update(owner, 'local', () => undefined);
    expect(await second.read(owner, 'server')).toBeUndefined();
    expect(await second.file(owner, 'local', 'file')).toBeUndefined();
    for (const generation of [
      aliasGeneration,
      await second.generation(owner, 'server'),
    ]) {
      await expect(
        second.save(owner, {
          ...snapshot('Late server edit'),
          key: 'server',
          draftId: 'server',
          generation,
        })
      ).rejects.toThrow('no longer active');
    }
    expect(await second.list(owner)).toEqual([]);
  });
});

describe('notification failures do not affect durable commits', () => {
  it('opens and saves when BroadcastChannel construction throws', async () => {
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        constructor() {
          throw new Error('Unavailable');
        }
      }
    );
    const store = open();
    const owner = await store.activate('owner');
    await store.save(owner, snapshot());
    expect(await store.list(owner)).toHaveLength(1);
  });
  it('resolves commits and notifies remaining listeners after notification errors', async () => {
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        postMessage() {
          throw new Error('Unavailable');
        }
        close() {}
      }
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = open();
    const owner = await store.activate('owner');
    const listener = vi.fn();
    store.subscribe(() => {
      throw new Error('Bad listener');
    });
    store.subscribe(listener);
    await store.save(owner, snapshot());
    expect(await store.list(owner)).toHaveLength(1);
    expect(listener).toHaveBeenCalledOnce();
  });
});
