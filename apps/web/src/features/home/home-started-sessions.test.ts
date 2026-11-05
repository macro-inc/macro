import type { EntityData } from '@entity';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it } from 'vitest';
import { createHomeStartedSessions } from './home-started-sessions';

// Effects run once a root's setup returns, so each test changes the list
// from outside the root, as the app's updates do.
let dispose = () => {};
afterEach(() => dispose());

const createStarted = (listed: () => EntityData[]) =>
  createRoot((disposeRoot) => {
    dispose = disposeRoot;
    const started = createHomeStartedSessions();
    return { record: started.record, rows: started.unlisted(listed) };
  });

it('shows a started session until the list holds its own row', () => {
  const [listed, setListed] = createSignal<EntityData[]>([]);
  const [sessionId, setSessionId] = createSignal<string>();
  const { record, rows } = createStarted(listed);

  record({
    id: 'session-1',
    pending: { sessionId, failed: () => false },
    prompt: 'Summarize this week in sales\nwith numbers',
    botId: 'bot-1',
    userId: 'macro|viewer@example.com',
    startedAt: '2026-11-05T12:00:00.000Z',
  });

  expect(rows()).toEqual([
    {
      type: 'agent_session',
      id: 'session-1',
      name: 'Summarize this week in sales',
      ownerId: 'macro|viewer@example.com',
      botId: 'bot-1',
      repoUrl: undefined,
      status: 'booting',
      source: 'user',
      visibility: 'listed',
      createdAt: '2026-11-05T12:00:00.000Z',
      updatedAt: '2026-11-05T12:00:00.000Z',
      sortTs: '2026-11-05T12:00:00.000Z',
    },
  ]);

  setSessionId('session-1');
  expect(rows().map((row) => row.id)).toEqual(['session-1']);

  setListed([
    {
      type: 'agent_session',
      id: 'session-1',
      name: 'Weekly sales summary',
      ownerId: 'macro|viewer@example.com',
      botId: 'bot-1',
      status: 'running',
    },
  ]);
  expect(rows()).toEqual([]);

  // Marked done, the server row leaves; the started row must not return.
  setListed([]);
  expect(rows()).toEqual([]);
});

it('follows the id the create answered with', () => {
  const [listed, setListed] = createSignal<EntityData[]>([]);
  const [sessionId, setSessionId] = createSignal<string>();
  const { record, rows } = createStarted(listed);

  record({
    id: 'expired-warm-claim',
    pending: { sessionId, failed: () => false },
    prompt: 'Draft the launch email',
    userId: 'macro|viewer@example.com',
    startedAt: '2026-11-05T12:00:00.000Z',
  });
  setSessionId('created-session');
  expect(rows().map((row) => row.id)).toEqual(['created-session']);

  setListed([
    {
      type: 'agent_session',
      id: 'created-session',
      name: 'Launch email',
      ownerId: 'macro|viewer@example.com',
      botId: '',
      status: 'running',
    },
  ]);
  expect(rows()).toEqual([]);
});

it('drops a session whose create failed', () => {
  const [failed, setFailed] = createSignal(false);
  const { record, rows } = createStarted(() => []);

  record({
    id: 'session-2',
    pending: { sessionId: () => undefined, failed },
    prompt: 'Plan the offsite',
    userId: 'macro|viewer@example.com',
    startedAt: '2026-11-05T12:00:00.000Z',
  });
  expect(rows().map((row) => row.id)).toEqual(['session-2']);

  setFailed(true);
  expect(rows()).toEqual([]);

  // Recovering a failed create never brings its row back.
  setFailed(false);
  expect(rows()).toEqual([]);
});
