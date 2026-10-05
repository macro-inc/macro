import { noopChatter } from '@macro-inc/collaboration/collab/chatter';
import type { SnapshotStore } from '@macro-inc/collaboration/collab/snapshot-store';
import {
  type LiveSyncSource,
  type SyncSourceEvent,
  SyncSourceStatus,
} from '@macro-inc/collaboration/collab/source';
import { InMemoryWALStore } from '@macro-inc/collaboration/collab/wal';
import { EphemeralStore, LoroDoc } from 'loro-crdt';
import { okAsync } from 'neverthrow';
import {
  type Accessor,
  createEffect,
  createRoot,
  createSignal,
  type Setter,
} from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type CollaborativeLayout,
  readLayout,
  seedLayout,
} from '../core/collaboration-layout';
import {
  createFormCollaborationSession,
  type FormCollaborationOptions,
  type FormConnection,
  FormFlushError,
} from './form-collaboration';

const FORM = '0199b000-0000-7000-8000-000000000001';
const CONTACT = '0199b000-0000-7000-8000-000000000002';
const NAME = '0199b000-0000-7000-8000-000000000003';
const NAME_COLUMN = '0199b000-0000-7000-8000-000000000004';
const BOOKING = '0199b000-0000-7000-8000-000000000006';
const EVENT_TYPE = '0199b000-0000-7000-8000-000000000007';
const PROFILE = '0199b000-0000-7000-8000-000000000008';

const contactForm = {
  sections: [
    {
      kind: 'questions' as const,
      id: CONTACT,
      title: 'Contact',
      description: '',
      questions: [
        {
          id: NAME,
          column: NAME_COLUMN,
          helpText: 'Your name',
          required: true,
          widget: 'short' as const,
        },
      ],
    },
  ],
};

/** The sync service's copy of one form, with one transport per tab. */
class FakeSurface {
  readonly doc = new LoroDoc();
  readonly transports = new Map<string, FakeTransport>();

  constructor(layout: CollaborativeLayout) {
    this.doc.import(seedLayout(layout));
  }

  connect(tab: string): FormConnection {
    const transport = new FakeTransport(this);
    this.transports.set(tab, transport);
    return {
      source: transport.source,
      doInitialSync: () =>
        okAsync({
          snapshot: this.doc.export({ mode: 'snapshot' }),
          awareness: new Uint8Array(),
        }),
    };
  }

  transport(tab: string): FakeTransport {
    const transport = this.transports.get(tab);
    if (!transport) throw new Error(`${tab} never connected`);
    return transport;
  }

  relay(from: FakeTransport, event: SyncSourceEvent) {
    for (const transport of this.transports.values()) {
      if (transport !== from && transport.connected()) transport.emit(event);
    }
  }
}

type HeldPush = {
  arrived: Promise<Uint8Array[]>;
  release: (acknowledged: boolean) => void;
};

class FakeTransport {
  readonly listeners = new Set<(event: SyncSourceEvent) => void>();
  readonly source: LiveSyncSource;
  cleanedUp = false;
  private readonly held: {
    arrive: (updates: Uint8Array[]) => void;
    acknowledged: Promise<boolean>;
  }[] = [];
  private readonly awarenessWaiters: ((awareness: Uint8Array) => void)[] = [];
  private readonly status: Accessor<SyncSourceStatus>;
  private readonly setStatus: Setter<SyncSourceStatus>;

  constructor(private readonly surface: FakeSurface) {
    [this.status, this.setStatus] = createSignal<SyncSourceStatus>(
      SyncSourceStatus.Connected
    );
    this.source = {
      documentId: FORM,
      status: this.status,
      listen: (listener) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
      pushUpdate: (updates) => this.push(updates),
      pushAwareness: (awareness) => {
        for (const waiter of this.awarenessWaiters.splice(0)) waiter(awareness);
        if (this.connected())
          this.surface.relay(this, { type: 'awareness', awareness });
      },
      registerPeerId: () => {},
      requestUpdatesSince: (version) =>
        okAsync(this.surface.doc.export({ mode: 'update', from: version })),
      requestSnapshot: () =>
        okAsync(this.surface.doc.export({ mode: 'snapshot' })),
      reconnect: () => {},
      cleanup: () => {
        this.cleanedUp = true;
        this.listeners.clear();
      },
    };
  }

  connected() {
    return this.status() === SyncSourceStatus.Connected;
  }

  goOffline() {
    this.setStatus(SyncSourceStatus.Disconnected);
  }

  goOnline() {
    this.setStatus(SyncSourceStatus.Connected);
  }

  emit(event: SyncSourceEvent) {
    for (const listener of this.listeners) listener(event);
  }

  /** Holds the next push until the test acknowledges or drops it. */
  holdNextPush(): HeldPush {
    const arrived = Promise.withResolvers<Uint8Array[]>();
    const acknowledged = Promise.withResolvers<boolean>();
    this.held.push({
      arrive: arrived.resolve,
      acknowledged: acknowledged.promise,
    });
    return { arrived: arrived.promise, release: acknowledged.resolve };
  }

  nextAwarenessPush(): Promise<Uint8Array> {
    return new Promise((resolve) => this.awarenessWaiters.push(resolve));
  }

  private async push(updates: Uint8Array[]): Promise<boolean> {
    const hold = this.held.shift();
    if (hold) {
      hold.arrive(updates);
      if (!(await hold.acknowledged)) return false;
    } else if (!this.connected()) {
      return false;
    }
    for (const update of updates) {
      this.surface.doc.import(update);
      this.surface.relay(this, { type: 'update', update });
    }
    return true;
  }
}

function memoryPersistence() {
  let cached: Uint8Array | null = null;
  const snapshots: SnapshotStore<Uint8Array> = {
    save: async (snapshot) => {
      cached = snapshot;
    },
    load: async () => cached,
    delete: async () => {
      cached = null;
    },
  };
  return {
    snapshots,
    wal: new InMemoryWALStore<Uint8Array>(),
    makeChatter: noopChatter,
  };
}

/** Resolves once `read` gives a value `done` accepts, by tracking it. */
function until<Value>(
  read: Accessor<Value>,
  done: (value: Value) => boolean
): Promise<Value> {
  return new Promise((resolve) => {
    createRoot((dispose) => {
      createEffect(() => {
        const value = read();
        if (!done(value)) return;
        dispose();
        resolve(value);
      });
    });
  });
}

function open(
  surface: FakeSurface,
  tab: string,
  overrides: Partial<FormCollaborationOptions> = {}
) {
  const published: CollaborativeLayout[] = [];
  const persistence = overrides.persistence ?? memoryPersistence();
  return createRoot((dispose) => ({
    dispose,
    published,
    persistence,
    session: createFormCollaborationSession({
      formId: FORM,
      userId: tab,
      initialize: async () => {},
      publish: async () => {
        published.push(readLayout(surface.doc));
        return {};
      },
      connect: () => surface.connect(tab),
      ...overrides,
      persistence,
    }),
  }));
}

function ready(opened: ReturnType<typeof open>) {
  return until(opened.session.state, (state) => state.kind === 'ready');
}

/** Rejects with the flush failure, or fails when the flush succeeds. */
async function flushFailure(opened: ReturnType<typeof open>) {
  try {
    await opened.session.flush();
  } catch (error) {
    if (error instanceof FormFlushError) return error.failure;
    throw error;
  }
  throw new Error('The flush succeeded.');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('form collaboration session', () => {
  it('merges a concurrent edit into a held one, then publishes what the server holds', async () => {
    const surface = new FakeSurface(contactForm);
    const calls: string[] = [];
    const publishedByAda: CollaborativeLayout[] = [];
    const ada = createRoot((dispose) => ({
      dispose,
      session: createFormCollaborationSession({
        formId: FORM,
        userId: 'ada',
        initialize: async () => {
          calls.push('initialize');
        },
        publish: async () => {
          publishedByAda.push(readLayout(surface.doc));
          return {};
        },
        connect: () => {
          calls.push('connect');
          return surface.connect('ada');
        },
        persistence: {
          snapshots: {
            save: async () => {},
            load: async () => null,
            delete: async () => {},
          },
          wal: new InMemoryWALStore<Uint8Array>(),
          makeChatter: noopChatter,
        },
      }),
    }));
    const grace = open(surface, 'grace');
    await until(ada.session.state, (state) => state.kind === 'ready');
    await ready(grace);
    expect(calls).toEqual(['initialize', 'connect']);
    expect(ada.session.layout()).toEqual(contactForm);

    const adaPush = surface.transport('ada').holdNextPush();
    ada.session.apply(contactForm, {
      sections: [
        {
          kind: 'questions',
          id: CONTACT,
          title: 'Contact details',
          description: '',
          questions: [
            {
              id: NAME,
              column: NAME_COLUMN,
              helpText: 'Your name',
              required: true,
              widget: 'short',
            },
          ],
        },
      ],
    });
    const flushed = ada.session.flush();
    await adaPush.arrived;
    grace.session.apply(contactForm, {
      sections: [
        {
          kind: 'questions',
          id: CONTACT,
          title: 'Contact',
          description: '',
          questions: [
            {
              id: NAME,
              column: NAME_COLUMN,
              helpText: 'Given and family name',
              required: true,
              widget: 'short',
            },
          ],
        },
      ],
    });
    await until(
      ada.session.layout,
      (layout) =>
        layout?.sections[0]?.kind === 'questions' &&
        layout.sections[0].questions[0]?.helpText === 'Given and family name'
    );
    expect(publishedByAda).toEqual([]);

    adaPush.release(true);
    await flushed;
    const merged = {
      sections: [
        {
          kind: 'questions',
          id: CONTACT,
          title: 'Contact details',
          description: '',
          questions: [
            {
              id: NAME,
              column: NAME_COLUMN,
              helpText: 'Given and family name',
              required: true,
              widget: 'short',
            },
          ],
        },
      ],
    };
    expect(publishedByAda).toEqual([merged]);
    expect(ada.session.layout()).toEqual(merged);
    expect(
      await until(
        grace.session.layout,
        (layout) =>
          layout?.sections[0]?.kind === 'questions' &&
          layout.sections[0].title === 'Contact details'
      )
    ).toEqual(merged);
    expect(ada.session.save()).toEqual({ kind: 'saved' });
    ada.dispose();
    grace.dispose();
  });

  it('waits for the engine to log an edit before flushing it', async () => {
    const surface = new FakeSurface(contactForm);
    const store = new InMemoryWALStore<Uint8Array>();
    const appending = Promise.withResolvers<void>();
    const landed = Promise.withResolvers<void>();
    const ada = open(surface, 'ada', {
      persistence: {
        ...memoryPersistence(),
        wal: {
          append: async (update) => {
            appending.resolve();
            await landed.promise;
            await store.append(update);
          },
          getAll: () => store.getAll(),
          markDelivered: (ids) => store.markDelivered(ids),
          pruneDelivered: () => store.pruneDelivered(),
          pruneExpired: (ttl) => store.pruneExpired(ttl),
          count: () => store.count(),
        },
      },
    });
    await ready(ada);
    ada.session.apply(contactForm, {
      sections: [{ ...contactForm.sections[0], title: 'Logged first' }],
    });
    const flushed = ada.session.flush();
    await appending.promise;
    // Give a flush that does not wait every chance to run ahead.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ada.published).toEqual([]);
    expect(readLayout(surface.doc).sections[0]?.title).toBe('Contact');

    landed.resolve();
    await flushed;
    expect(ada.published.map((layout) => layout.sections[0]?.title)).toEqual([
      'Logged first',
    ]);
    ada.dispose();
  });

  it('keeps an unacknowledged edit, rejects the flush, and delivers it on the next one', async () => {
    const surface = new FakeSurface(contactForm);
    const ada = open(surface, 'ada');
    await ready(ada);
    const dropped = surface.transport('ada').holdNextPush();
    ada.session.apply(contactForm, {
      sections: [{ ...contactForm.sections[0], title: 'Reach us' }],
    });
    const failure = flushFailure(ada);
    await dropped.arrived;
    dropped.release(false);
    expect(await failure).toEqual({ kind: 'unsaved', pending: 1 });
    expect(ada.session.save()).toEqual({
      kind: 'unsaved',
      reason: 'undelivered',
    });
    expect(ada.published).toEqual([]);
    expect(readLayout(surface.doc).sections[0]?.title).toBe('Contact');
    expect(await ada.persistence.wal.getAll()).toMatchObject([
      { delivered: false },
    ]);

    await ada.session.flush();
    expect(readLayout(surface.doc).sections[0]?.title).toBe('Reach us');
    expect(ada.published).toHaveLength(1);
    expect(ada.session.save()).toEqual({ kind: 'saved' });
    ada.dispose();
  });

  it('refuses to flush while offline, after the edit is in the local log', async () => {
    const surface = new FakeSurface(contactForm);
    const ada = open(surface, 'ada');
    await ready(ada);
    surface.transport('ada').goOffline();
    ada.session.apply(contactForm, {
      sections: [{ ...contactForm.sections[0], title: 'Offline title' }],
    });
    expect(await flushFailure(ada)).toEqual({ kind: 'offline' });
    expect(ada.session.connection()).toBe('offline');
    expect(await ada.persistence.wal.getAll()).toMatchObject([
      { delivered: false },
    ]);
    expect(ada.published).toEqual([]);
    ada.dispose();
  });

  it('reopens from the local snapshot and log, then delivers the offline edit', async () => {
    const surface = new FakeSurface(contactForm);
    const first = open(surface, 'first');
    await ready(first);
    surface.transport('first').goOffline();
    first.session.apply(contactForm, {
      sections: [{ ...contactForm.sections[0], title: 'Written offline' }],
    });
    expect(await flushFailure(first)).toEqual({ kind: 'offline' });
    first.dispose();
    expect(surface.transport('first').cleanedUp).toBe(true);

    const initialized = Promise.withResolvers<void>();
    const second = open(surface, 'second', {
      persistence: first.persistence,
      initialize: () => initialized.promise,
    });
    await ready(second);
    expect(second.session.layout()?.sections[0]?.title).toBe('Written offline');
    expect(surface.transports.has('second')).toBe(false);

    initialized.resolve();
    await second.session.flush();
    expect(readLayout(surface.doc).sections[0]?.title).toBe('Written offline');
    expect(second.published).toHaveLength(1);
    second.dispose();
  });

  it('edits a booking section and publishes it', async () => {
    const surface = new FakeSurface({
      sections: [
        ...contactForm.sections,
        {
          kind: 'booking',
          id: BOOKING,
          title: 'Pick a time',
          description: 'Thirty minutes with the team.',
          target: { eventTypeId: EVENT_TYPE, profileId: PROFILE },
        },
      ],
    });
    const ada = open(surface, 'ada');
    const grace = open(surface, 'grace');
    await ready(ada);
    await ready(grace);
    const opened = {
      sections: [
        ...contactForm.sections,
        {
          kind: 'booking' as const,
          id: BOOKING,
          title: 'Pick a time',
          description: 'Thirty minutes with the team.',
          target: { eventTypeId: EVENT_TYPE, profileId: PROFILE },
        },
      ],
    };
    expect(ada.session.layout()).toEqual(opened);

    const renamed = {
      sections: [
        ...contactForm.sections,
        {
          kind: 'booking' as const,
          id: BOOKING,
          title: 'Book an interview',
          description: 'Thirty minutes with the team.',
          target: { eventTypeId: EVENT_TYPE, profileId: PROFILE },
        },
      ],
    };
    ada.session.apply(opened, renamed);
    await ada.session.flush();
    expect(readLayout(surface.doc)).toEqual(renamed);
    expect(ada.published).toEqual([renamed]);
    expect(
      await until(
        grace.session.layout,
        (layout) => layout?.sections[1]?.title === 'Book an interview'
      )
    ).toEqual(renamed);
    ada.dispose();
    grace.dispose();
  });

  it('fails the flush while the local log refuses an edit, and logs it once the log recovers', async () => {
    const surface = new FakeSurface(contactForm);
    const store = new InMemoryWALStore<Uint8Array>();
    let refusing = true;
    const refused = Promise.withResolvers<void>();
    const ada = open(surface, 'ada', {
      persistence: {
        ...memoryPersistence(),
        wal: {
          append: async (update) => {
            if (refusing) {
              refused.resolve();
              throw new DOMException('Quota exceeded', 'QuotaExceededError');
            }
            await store.append(update);
          },
          getAll: () => store.getAll(),
          markDelivered: (ids) => store.markDelivered(ids),
          pruneDelivered: () => store.pruneDelivered(),
          pruneExpired: (ttl) => store.pruneExpired(ttl),
          count: () => store.count(),
        },
      },
    });
    await ready(ada);
    ada.session.apply(contactForm, {
      sections: [{ ...contactForm.sections[0], title: 'Not logged' }],
    });
    await refused.promise;
    expect(
      await until(ada.session.save, (save) => save.kind === 'unsaved')
    ).toEqual({ kind: 'unsaved', reason: 'storage' });
    expect(await flushFailure(ada)).toEqual({ kind: 'storage' });
    expect(ada.session.save()).toEqual({ kind: 'unsaved', reason: 'storage' });
    expect(ada.published).toEqual([]);
    expect(readLayout(surface.doc).sections[0]?.title).toBe('Contact');
    expect(await store.getAll()).toEqual([]);

    refusing = false;
    await ada.session.flush();
    expect(readLayout(surface.doc).sections[0]?.title).toBe('Not logged');
    expect(ada.published.map((layout) => layout.sections[0]?.title)).toEqual([
      'Not logged',
    ]);
    expect(ada.session.save()).toEqual({ kind: 'saved' });
    ada.dispose();
  });

  it('connects when the browser comes back online after opening offline from the cache', async () => {
    const surface = new FakeSurface(contactForm);
    const first = open(surface, 'first');
    await ready(first);
    surface.transport('first').goOffline();
    first.session.apply(contactForm, {
      sections: [{ ...contactForm.sections[0], title: 'Written offline' }],
    });
    expect(await flushFailure(first)).toEqual({ kind: 'offline' });
    first.dispose();

    let initializations = 0;
    let connections = 0;
    const refused = Promise.withResolvers<void>();
    const second = open(surface, 'second', {
      persistence: first.persistence,
      initialize: async () => {
        initializations++;
        if (initializations === 1) {
          refused.resolve();
          throw new TypeError('Failed to fetch');
        }
      },
      connect: () => {
        connections++;
        return surface.connect('second');
      },
    });
    await ready(second);
    await refused.promise;
    await until(second.session.connection, (status) => status === 'offline');
    expect(surface.transports.has('second')).toBe(false);

    window.dispatchEvent(new Event('online'));
    await until(second.session.connection, (status) => status === 'connected');
    window.dispatchEvent(new Event('online'));
    await second.session.flush();
    expect(initializations).toBe(2);
    expect(connections).toBe(1);
    expect(readLayout(surface.doc).sections[0]?.title).toBe('Written offline');

    second.dispose();
    window.dispatchEvent(new Event('online'));
    expect(initializations).toBe(2);
  });

  it('publishes once after a burst of keystrokes is delivered', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const surface = new FakeSurface(contactForm);
    const ada = open(surface, 'ada');
    await ready(ada);
    let previous = contactForm;
    for (const title of ['C', 'Co', 'Con']) {
      const next = {
        sections: [{ ...contactForm.sections[0], title }],
      };
      ada.session.apply(previous, next);
      previous = next;
    }
    await until(ada.session.save, (save) => save.kind === 'saved');
    expect(readLayout(surface.doc).sections[0]?.title).toBe('Con');
    expect(ada.published).toEqual([]);

    await vi.runAllTimersAsync();
    expect(ada.published.map((layout) => layout.sections[0]?.title)).toEqual([
      'Con',
    ]);
    ada.dispose();
  });

  it('rejects the flush with the server publication error and clears it once valid', async () => {
    const surface = new FakeSurface(contactForm);
    const answers = [
      { publicationError: 'The question "Name" has no column.' },
      {},
    ];
    const ada = open(surface, 'ada', {
      publish: async () => answers.shift() ?? {},
    });
    await ready(ada);
    expect(await flushFailure(ada)).toEqual({
      kind: 'publication',
      message: 'The question "Name" has no column.',
    });
    expect(ada.session.publicationError()).toBe(
      'The question "Name" has no column.'
    );

    await ada.session.flush();
    expect(ada.session.publicationError()).toBeUndefined();
    ada.dispose();
  });

  it('fails to open on a snapshot that is not a Loro document', async () => {
    const ada = open(new FakeSurface(contactForm), 'ada', {
      connect: () => ({
        source: new FakeTransport(new FakeSurface(contactForm)).source,
        doInitialSync: () =>
          okAsync({
            snapshot: new Uint8Array([1, 2, 3]),
            awareness: new Uint8Array(),
          }),
      }),
    });
    expect(
      await until(ada.session.state, (state) => state.kind === 'error')
    ).toEqual({ kind: 'error', message: 'This form could not be opened.' });
    expect(ada.session.layout()).toBeUndefined();
    ada.dispose();
  });

  it('refuses a layout of a kind the wire model does not know', async () => {
    const surface = new FakeSurface({
      sections: [{ kind: 'poll', id: CONTACT, title: 'Lunch?' }],
    });
    const ada = open(surface, 'ada');
    expect(
      await until(ada.session.state, (state) => state.kind === 'error')
    ).toEqual({
      kind: 'error',
      message: 'This form was edited by a newer version of Macro.',
    });
    expect(ada.session.layout()).toBeUndefined();
    expect(() => ada.session.apply(contactForm, contactForm)).toThrow();
    ada.dispose();
  });

  it('reads nested rule groups, and refuses a malformed one', async () => {
    const SCREENING = '0199b000-0000-7000-8000-000000000005';
    const gate = {
      kind: 'gate',
      id: SCREENING,
      title: 'Screening',
      description: '',
      message: 'Not this time',
      rules: {
        conjunction: 'and',
        conditions: [
          {
            kind: 'group',
            conjunction: 'or',
            conditions: [
              {
                kind: 'condition',
                column: NAME_COLUMN,
                test: { kind: 'presence', operator: 'isNotEmpty' },
              },
            ],
          },
        ],
      },
    };
    const valid = open(
      new FakeSurface({ sections: [...contactForm.sections, gate] }),
      'valid'
    );
    await ready(valid);
    expect(valid.session.layout()).toEqual({
      sections: [...contactForm.sections, gate],
    });
    valid.dispose();

    const malformed = open(
      new FakeSurface({
        sections: [
          {
            ...gate,
            rules: {
              conjunction: 'and',
              conditions: [{ kind: 'group', conjunction: 'xor' }],
            },
          },
        ],
      }),
      'malformed'
    );
    expect(
      await until(malformed.session.state, (state) => state.kind === 'error')
    ).toEqual({
      kind: 'error',
      message: 'This form was edited by a newer version of Macro.',
    });
    malformed.dispose();
  });

  it('fails to open when the server cannot prepare the form, without connecting', async () => {
    const surface = new FakeSurface(contactForm);
    let initializations = 0;
    const ada = open(surface, 'ada', {
      initialize: async () => {
        initializations++;
        throw new Error('503');
      },
    });
    expect(
      await until(ada.session.state, (state) => state.kind === 'error')
    ).toEqual({ kind: 'error', message: 'Unable to connect to this form.' });
    expect(surface.transports.size).toBe(0);
    ada.dispose();
    window.dispatchEvent(new Event('online'));
    expect(initializations).toBe(1);
  });

  it('stops publishing and listening once disposed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const surface = new FakeSurface(contactForm);
    const ada = open(surface, 'ada');
    await ready(ada);
    ada.session.apply(contactForm, {
      sections: [{ ...contactForm.sections[0], title: 'Last edit' }],
    });
    await until(ada.session.save, (save) => save.kind === 'saved');
    ada.dispose();

    await vi.runAllTimersAsync();
    expect(ada.published).toEqual([]);
    expect(surface.transport('ada').cleanedUp).toBe(true);
    expect(surface.transport('ada').listeners.size).toBe(0);
  });

  it('shows what other editors selected, and drops what it cannot read', async () => {
    const surface = new FakeSurface(contactForm);
    const ada = open(surface, 'ada');
    const grace = open(surface, 'grace');
    await ready(ada);
    await ready(grace);

    const rogue = new EphemeralStore(10_000);
    rogue.set('42', {
      user: { userId: 'mallory', color: 'red', peerId: '42' },
      selection: { sectionId: 7 },
    });
    surface.transport('grace').emit({
      type: 'awareness',
      awareness: rogue.encode('42'),
    });
    ada.session.setSelection({ sectionId: CONTACT, questionId: NAME });
    const peers = await until(grace.session.peers, (peers) =>
      peers.some((peer) => peer.userId === 'ada')
    );
    expect(peers).toEqual([
      {
        peerId: expect.any(String),
        userId: 'ada',
        color: expect.any(String),
        selection: { sectionId: CONTACT, questionId: NAME },
      },
    ]);

    ada.session.setSelection(undefined);
    await until(grace.session.peers, (peers) => peers.length === 0);
    ada.dispose();
    grace.dispose();
  });

  it('repeats an idle selection so it does not expire', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const surface = new FakeSurface(contactForm);
    const ada = open(surface, 'ada');
    await ready(ada);
    const first = surface.transport('ada').nextAwarenessPush();
    ada.session.setSelection({ sectionId: CONTACT, questionId: null });
    await first;

    const heartbeat = surface.transport('ada').nextAwarenessPush();
    vi.advanceTimersByTime(3_000);
    await heartbeat;
    ada.dispose();
  });
});
