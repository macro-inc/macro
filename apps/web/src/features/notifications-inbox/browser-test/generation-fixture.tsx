import { fireAndForget } from '@core/util/fireAndForget';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { createFakeAttentionFeedClient } from '@queries/attention-feed/tests/fake-client';
import { For } from 'solid-js';
import { createStore } from 'solid-js/store';
import { ALL_INBOX_ROW_TYPES } from '../core/inbox-filters';
import { createNotificationInboxSource } from '../queries/notification-inbox-source';
import { inboxEntry, inboxPage, upsertedPatch } from '../tests/wire';

/** The real source and publication path, with only its transport held by buttons. */
export function NotificationGenerationFixture() {
  const operation = new URLSearchParams(location.search).get('generation');
  const entry = inboxEntry({
    docId: 'generation-document',
    sortAt: '2026-02-01T10:09:00Z',
    rows: [
      {
        id: 'document:generation-document#top_level',
        latestAt: '2026-02-01T10:09:00Z',
        revision: 'before',
        notificationIds: ['notification-a', 'notification-b'],
      },
    ],
  });
  const confirmed = inboxEntry({
    docId: 'generation-document',
    sortAt: entry.sortAt,
    rows: [
      {
        id: entry.rows[0].id,
        latestAt: entry.sortAt,
        revision: 'confirmed',
        unseen: operation !== 'seen',
        notificationIds:
          operation === 'done'
            ? ['notification-a']
            : ['notification-a', 'notification-b'],
      },
    ],
  });
  const patches = [upsertedPatch(confirmed)];
  let release = (_value: unknown) => {};
  const reply = new Promise<unknown>((resolve) => {
    release = resolve;
  });
  const fake = createFakeAttentionFeedClient({
    MarkNotificationInboxNotificationDone: reply,
    MarkNotificationInboxRowsDone: {
      markNotificationInboxRowsDone: { rowIds: [], undoToken: 'fixture-undo' },
    },
    UndoNotificationInboxRowsDone: reply,
    MarkNotificationInboxRowsSeen: reply,
  });
  const [state, setState] = createStore({
    phase: 'ready',
    dispatched: '',
    baseline: '',
    written: '',
    error: '',
  });
  const executeQuery = fake.client.executeQuery;
  fake.client.executeQuery = (request, context) => {
    const source = executeQuery(request, context);
    const query = fake.queries.at(-1);
    // Deliver after the source subscribes, without a timer or a polling loop.
    queueMicrotask(() => query?.resolve(inboxPage([entry])));
    return source;
  };
  const host = {
    ...fake.host,
    writeQuery: async (...args: Parameters<typeof fake.host.writeQuery>) => {
      const result = await fake.host.writeQuery(...args);
      setState('written', args[0].generation ?? 'missing');
      return result;
    },
  };
  const feed = createNotificationInboxSource({
    client: () => fake.client,
    cacheHost: () => host,
    scope: () => ({ rowTypes: ALL_INBOX_ROW_TYPES, allKinds: true }),
    enabled: () => true,
  });
  const start = async () => {
    try {
      const row = feed.rows()?.[0];
      if (!row) throw new Error('Fixture row has not loaded');
      let pending: Promise<unknown>;
      if (operation === 'undo') {
        const done = await feed.markDone([row]);
        pending = done.undo();
      } else if (operation === 'done') {
        pending = feed.markNotificationDone(row, row.content.notifications[1]);
      } else {
        pending = feed.markSeen([row]);
      }
      setState({
        phase: 'pending',
        dispatched: cacheSessionGeneration.capture(),
      });
      await pending;
      setState('phase', 'settled');
    } catch (error) {
      setState('error', error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <main class="flex flex-col gap-3 p-4 text-ink">
      <button
        type="button"
        class="min-h-11 border border-edge px-4"
        disabled={!feed.rows()?.length || state.phase !== 'ready'}
        onClick={() =>
          fireAndForget(start(), 'notification-generation-fixture')
        }
      >
        Start mutation
      </button>
      <button
        type="button"
        class="min-h-11 border border-edge px-4"
        disabled={state.phase !== 'pending' || !!state.baseline}
        onClick={() => {
          cacheSessionGeneration.initialize(crypto.randomUUID());
          setState('baseline', cacheSessionGeneration.capture());
        }}
      >
        Learn owner baseline
      </button>
      <button
        type="button"
        class="min-h-11 border border-edge px-4"
        disabled={!state.baseline || state.phase !== 'pending'}
        onClick={() =>
          release({
            markNotificationInboxNotificationDone: {
              patches,
              undoToken: 'fixture-undo',
            },
            undoNotificationInboxRowsDone: { patches },
            markNotificationInboxRowsSeen: { patches },
          })
        }
      >
        Release response
      </button>
      <output data-testid="generation-phase">{state.phase}</output>
      <output data-testid="generation-dispatched">{state.dispatched}</output>
      <output data-testid="generation-baseline">{state.baseline}</output>
      <output data-testid="generation-written">{state.written}</output>
      <output data-testid="generation-error">{state.error}</output>
      <ul>
        <For each={feed.rows()}>
          {(row) => (
            <li data-testid="generation-row">
              {row.id}: {row.count} notifications,{' '}
              {row.unseen ? 'unseen' : 'seen'}
              <output data-testid="generation-revision">{row.revision}</output>
            </li>
          )}
        </For>
      </ul>
    </main>
  );
}
