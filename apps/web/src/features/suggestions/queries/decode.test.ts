import type { Suggestion as WireSuggestion } from '@service-scheduled-action/generated/schemas';
import { expect, it } from 'vitest';
import { toFeed, toSuggestion } from './decode';

const WIRE: WireSuggestion = {
  id: 'suggestion-1',
  title: 'Post the weekly status summary',
  summary: 'This week has none.',
  importance: 80,
  dedupKey: 'weekly-status',
  categories: ['important'],
  state: 'accepted',
  status: 'running',
  isNew: false,
  createdAt: '2026-11-09T06:00:00Z',
  stateChangedAt: '2026-11-09T08:00:00Z',
  updatedAt: '2026-11-09T08:00:00Z',
  about: [{ entityType: 'channel', entityId: 'channel-1', partId: null }],
  produced: [],
  run: {
    sessionId: 'session-1',
    startedAt: '2026-11-09T08:00:00Z',
    state: 'running',
    stateChangedAt: '2026-11-09T08:00:05Z',
  },
  kind: 'prompt',
  prompt: 'Summarize this week and post it.',
  runMode: 'background',
  sends: 'Posts the weekly status summary in #ops',
};
const COUNTS = { open: 0, running: 0, failed: 0, done: 0 };

it('reads a running background suggestion with the server’s status and what it will send', () => {
  expect(toSuggestion(WIRE)).toEqual({
    id: 'suggestion-1',
    kind: 'prompt',
    runMode: 'background',
    prompt: 'Summarize this week and post it.',
    sends: 'Posts the weekly status summary in #ops',
    run: { sessionId: 'session-1', startedAt: '2026-11-09T08:00:00Z' },
    title: 'Post the weekly status summary',
    summary: 'This week has none.',
    importance: 80,
    categories: ['important'],
    status: 'running',
    isNew: false,
    createdAt: '2026-11-09T06:00:00Z',
    stateChangedAt: '2026-11-09T08:00:00Z',
    updatedAt: '2026-11-09T08:00:00Z',
    about: [{ entityType: 'channel', entityId: 'channel-1' }],
  });
});

it('takes the status as the server gives it, whatever the run’s own state', () => {
  const suggestion = toSuggestion({
    ...WIRE,
    status: 'done',
    run: WIRE.run ? { ...WIRE.run, state: 'stopping' } : null,
    result: { entityType: 'document', entityId: 'document-1', partId: null },
  });

  expect(suggestion).toMatchObject({
    status: 'done',
    result: { entityType: 'document', entityId: 'document-1' },
  });
});

it('keeps a reply suggestion’s draft with its preview, who wrote and since when they wait', () => {
  const suggestion = toSuggestion({
    ...WIRE,
    state: 'proposed',
    status: 'open',
    run: null,
    kind: 'entity',
    action: 'reply',
    from: 'Priya Shah',
    waitingSince: '2026-11-07T09:00:00Z',
    draft: {
      entityType: 'email_thread',
      entityId: 'thread-1',
      partId: 'draft-1',
      preview: 'Approved, thanks.',
    },
  });

  expect(suggestion).toMatchObject({
    kind: 'entity',
    action: 'reply',
    from: 'Priya Shah',
    waitingSince: '2026-11-07T09:00:00Z',
    draft: {
      entityType: 'email_thread',
      entityId: 'thread-1',
      partId: 'draft-1',
      preview: 'Approved, thanks.',
    },
  });
});

it('leaves out a suggestion whose status the feed never shows', () => {
  expect(toSuggestion({ ...WIRE, status: 'closed' })).toBeUndefined();
});

it('keeps the server’s two lists in order, open then done, with its counts', () => {
  const open = { ...WIRE, id: 'open', status: 'open', run: null } as const;
  const done = { ...WIRE, id: 'done', status: 'done' } as const;
  const counts = { ...COUNTS, open: 1, done: 1 };

  const feed = toFeed({ suggestions: [open], done: [done], counts });

  expect(feed.suggestions.map((suggestion) => suggestion.id)).toEqual([
    'open',
    'done',
  ]);
  expect(feed.counts).toEqual(counts);
});

it('reads a feed asked for with a limit, which has no done list', () => {
  const open = { ...WIRE, id: 'open', status: 'open', run: null } as const;

  expect(
    toFeed({ suggestions: [open], counts: COUNTS }).suggestions
  ).toHaveLength(1);
});
