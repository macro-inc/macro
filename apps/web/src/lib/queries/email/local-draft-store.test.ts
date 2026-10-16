import { Blob as NodeBlob } from 'node:buffer';
import 'fake-indexeddb/auto';
import type { LocalDraft } from '@app/features/email-compose/core/local-draft';
import { createDraftAutosave } from '@app/features/email-compose/primitives/draft-autosave';
import { forceCloseDatabase } from 'fake-indexeddb';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('draft connection recovery', () => {
  let connections: IDBDatabase[];
  beforeEach(() => {
    connections = [];
    const original = indexedDB.open.bind(indexedDB);
    vi.spyOn(indexedDB, 'open').mockImplementation((...args) => {
      const request = original(...args);
      request.addEventListener('success', () =>
        connections.push(request.result)
      );
      return request;
    });
  });

  it('reopens without losing frozen sends, cancellation decisions or editing locks', async () => {
    const store = open();
    const session = await store.activate('owner');
    await store.save(session, snapshot());
    await store.putSend(session, sendIntent(), true);
    connections[0].close();
    expect(await store.sends(session)).toEqual([sendIntent()]);
    await expect(store.save(session, snapshot('Late edit', 1))).rejects.toThrow(
      'Cancel and restore'
    );
    await store.putSend(session, {
      ...sendIntent(),
      cancellationRequested: true,
    });
    connections.at(-1)!.close();
    expect((await store.sends(session))[0].cancellationRequested).toBe(true);
    await expect(
      store.save(session, snapshot('Still locked', 1))
    ).rejects.toThrow('Cancel and restore');
  });

  it.each(['closed', 'terminated'])(
    'saves the latest edit and continues server autosave after a connection is %s',
    async (reason) => {
      const store = open();
      const session = await store.activate('owner');
      await store.save(session, snapshot());
      if (reason === 'closed') connections[0].close();
      else {
        const db = connections[0];
        const closed = new Promise<void>((resolve) =>
          db.addEventListener('close', () => resolve(), { once: true })
        );
        // fake-indexeddb accepts an instance but declares a constructor type.
        forceCloseDatabase(
          db as unknown as Parameters<typeof forceCloseDatabase>[0]
        );
        await closed;
      }
      const latest = snapshot('After resuming', 1);
      const persist = vi.fn(async () => {
        expect(await store.read(session, 'local')).toMatchObject({
          revision: 2,
          content: latest.content,
        });
      });
      const onLocalError = vi.fn();
      let dispose = () => {};
      const autosave = createRoot((cleanup) => {
        dispose = cleanup;
        return createDraftAutosave({
          capture: () => latest,
          saveLocalSnapshot: async (value) => {
            await store.save(session, value);
          },
          persist,
          paused: () => false,
          onLocalError,
        });
      });
      try {
        await autosave.save();
        expect(persist).toHaveBeenCalledExactlyOnceWith(latest);
        expect(onLocalError).not.toHaveBeenCalled();
        expect(autosave.localSaveState()).toBe('saved');
        expect(connections).toHaveLength(2);
      } finally {
        dispose();
      }
    }
  );

  it('shares a reopened connection across concurrent operations without duplicate revisions', async () => {
    const store = open();
    const session = await store.activate('owner');
    await store.save(session, snapshot());
    connections[0].close();
    const notify = vi.fn();
    store.subscribe(notify);
    await Promise.all([
      store.save(session, snapshot('New revision', 1)),
      store.list(session),
      store.read(session, 'local'),
    ]);
    expect(connections).toHaveLength(2);
    expect(notify).toHaveBeenCalledOnce();
    expect(await store.read(session, 'local')).toMatchObject({ revision: 2 });
  });

  it('bounds retries, reports one failure per episode and allows a later recovery', async () => {
    const report = vi.fn();
    const store = createLocalDraftStore(crypto.randomUUID(), report);
    stores.push(store);
    const session = await store.activate('owner');
    const error = new DOMException(
      'Connection is closing',
      'InvalidStateError'
    );
    const transaction = vi
      .spyOn(IDBDatabase.prototype, 'transaction')
      .mockImplementation(() => {
        throw error;
      });
    await expect(store.save(session, snapshot())).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledTimes(2);
    await expect(store.save(session, snapshot())).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledTimes(4);
    expect(report).toHaveBeenCalledExactlyOnceWith({ type: 'failed', error });
    transaction.mockRestore();
    await store.save(session, snapshot());
    expect(report).toHaveBeenLastCalledWith({ type: 'recovered' });
    expect(await store.read(session, 'local')).toMatchObject({ revision: 1 });
  });

  it('does not retry unrelated transaction errors', async () => {
    const store = open();
    const session = await store.activate('owner');
    const error = new DOMException('Quota exhausted', 'QuotaExceededError');
    const transaction = vi
      .spyOn(connections[0], 'transaction')
      .mockImplementationOnce(() => {
        throw error;
      });
    await expect(store.save(session, snapshot())).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledOnce();
    expect(connections).toHaveLength(1);
    await store.save(session, snapshot());
  });

  it('never replays a started transaction when a request throws InvalidStateError', async () => {
    const store = open();
    const session = await store.activate('owner');
    const error = new DOMException('Request failed', 'InvalidStateError');
    const get = vi
      .spyOn(IDBObjectStore.prototype, 'get')
      .mockImplementationOnce(() => {
        throw error;
      });
    await expect(store.save(session, snapshot())).rejects.toBe(error);
    expect(get).toHaveBeenCalledOnce();
    expect(connections).toHaveLength(1);
    await store.save(session, snapshot());
    expect(await store.read(session, 'local')).toMatchObject({ revision: 1 });
  });

  it('keeps account fences after reopening', async () => {
    const name = crypto.randomUUID();
    const store = open(name);
    const session = await store.activate('owner');
    await store.save(session, snapshot());
    connections[0].close();
    const other = open(name);
    await other.clear(true);
    await other.activate('other-owner');
    await expect(store.save(session, snapshot('Late edit', 1))).rejects.toThrow(
      'no longer active'
    );
    expect(await store.list(session)).toEqual([]);
  });

  it('retries a later open after a synchronous opening failure', async () => {
    const store = open();
    vi.mocked(indexedDB.open).mockImplementationOnce(() => {
      throw new DOMException('Storage unavailable', 'UnknownError');
    });
    await expect(store.activate('owner')).rejects.toThrow(
      'Storage unavailable'
    );
    const session = await store.activate('owner');
    await store.save(session, snapshot());
    expect(await store.list(session)).toHaveLength(1);
  });

  it('does not let an old close event invalidate the replacement connection', async () => {
    const store = open();
    const session = await store.activate('owner');
    const old = connections[0];
    old.close();
    await store.save(session, snapshot());
    old.onclose?.call(old, new Event('close'));
    await store.list(session);
    expect(connections).toHaveLength(2);
  });

  it('keeps persistence working when recovery reporting throws', async () => {
    const report = vi.fn(() => {
      throw new Error('Telemetry unavailable');
    });
    const store = createLocalDraftStore(crypto.randomUUID(), report);
    stores.push(store);
    const session = await store.activate('owner');
    connections[0].close();
    await store.save(session, snapshot());
    expect(report).toHaveBeenCalledExactlyOnceWith({ type: 'recovered' });
    expect(await store.list(session)).toHaveLength(1);
  });
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

const sendIntent = (
  uuid = 'attempt'
): import('./send-queue').EmailSendIntent => ({
  uuid,
  phase: 'pending',
  locallyCancelled: false,
  metadata: {
    kind: 'email-send-v1',
    payload: {
      input: {
        attempt: { attemptId: uuid, linkId: 'inbox' },
        message: {
          draftId: 'local',
          subject: 'Approved',
          linkId: 'inbox',
          bodyText: 'Approved body',
        },
        attachmentIds: [],
        forwardedAttachmentIds: [],
      },
      draft: {
        draftId: 'local',
        threadDbId: 'thread',
        senderEmail: 'owner@example.com',
        optimisticBodyHtml: null,
        senderLinkId: 'inbox',
        subject: 'Approved',
        bodyText: 'Approved body',
      },
      workingCopy: {
        key: 'local',
        generation: 'generation',
        revision: 1,
        attachments: [],
      },
    },
  },
});

describe('independent send recovery records', () => {
  it('retains the frozen snapshot and attempt identity independently of the cache', async () => {
    const name = crypto.randomUUID();
    const first = open(name);
    const owner = await first.activate('owner');
    await first.save(owner, snapshot());
    await first.putSend(owner, sendIntent(), true);
    await first.close();
    const second = open(name);
    const restoredOwner = await second.activate('owner');
    expect(await second.sends(restoredOwner)).toEqual([sendIntent()]);
    await expect(
      second.save(restoredOwner, snapshot('Late edit', 1))
    ).rejects.toThrow('Cancel and restore');
    expect((await second.read(restoredOwner, 'local'))?.content.subject).toBe(
      'Keep this draft'
    );
  });
  it('atomically admits only one send across tabs and rejects a stale snapshot', async () => {
    const name = crypto.randomUUID();
    const first = open(name),
      second = open(name);
    const owner = await first.activate('owner');
    await second.activate('owner', owner.epoch);
    await first.save(owner, snapshot());
    const results = await Promise.allSettled([
      first.putSend(owner, sendIntent('one'), true),
      second.putSend(owner, sendIntent('two'), true),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled')
    ).toHaveLength(1);
    expect(await first.sends(owner)).toHaveLength(1);
    await first.removeSend(owner, (await first.sends(owner))[0].uuid);
    await first.save(owner, snapshot('New edit', 1));
    await expect(first.putSend(owner, sendIntent(), true)).rejects.toThrow(
      'changed'
    );
  });
  it('keeps cancellation and restoration when a late original send settles', async () => {
    const store = open(),
      owner = await store.activate('owner');
    await store.save(owner, snapshot());
    await store.putSend(
      owner,
      { ...sendIntent(), cancellationRequested: true },
      true
    );
    await store.putSend(owner, sendIntent());
    expect((await store.sends(owner))[0].cancellationRequested).toBe(true);
    const restored = sendIntent();
    restored.metadata.payload.restoring = true;
    await store.putSend(owner, restored);
    await store.putSend(owner, sendIntent());
    expect((await store.sends(owner))[0].metadata.payload.restoring).toBe(true);
    await expect(
      store.save(owner, snapshot('Restored edit', 1))
    ).resolves.toMatchObject({ revision: 2 });
  });
  it('clears send content and fences old sessions on account changes and logout', async () => {
    const store = open(),
      owner = await store.activate('owner');
    await store.save(owner, snapshot());
    await store.putSend(owner, sendIntent(), true);
    const next = await store.activate('next', 'next-epoch');
    expect(await store.sends(next)).toEqual([]);
    await expect(store.putSend(owner, sendIntent())).rejects.toThrow(
      'no longer active'
    );
    await store.clear(true, next.epoch);
    expect(await store.sends(next)).toEqual([]);
  });
});

it('a late old restoration cannot release a newer send reservation', async () => {
  const store = open(),
    owner = await store.activate('owner');
  await store.save(owner, snapshot());
  const old = sendIntent('old');
  old.metadata.payload.restoring = true;
  await store.putSend(owner, old);
  await store.putSend(owner, sendIntent('new'), true);
  await store.putSend(owner, { ...old, phase: 'committed' });
  await expect(store.save(owner, snapshot('Late edit', 1))).rejects.toThrow(
    'Cancel and restore'
  );
  expect(
    (await store.sends(owner)).find((row) => row.uuid === 'new')
  ).toBeDefined();
});
