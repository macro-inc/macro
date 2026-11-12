import type { Suggestion as WireSuggestion } from '@service-scheduled-action/generated/schemas';
import { expect, it } from 'vitest';
import { suggestionStatus } from '../core/suggestion';
import { toSuggestion, toSuggestions } from './decode';

const WIRE: WireSuggestion = {
  id: 'suggestion-1',
  title: 'Post the weekly status summary',
  summary: 'This week has none.',
  importance: 80,
  dedupKey: 'weekly-status',
  categories: ['important'],
  state: 'accepted',
  createdAt: '2026-11-09T06:00:00Z',
  stateChangedAt: '2026-11-09T08:00:00Z',
  updatedAt: '2026-11-09T08:00:00Z',
  about: [{ entityType: 'channel', entityId: 'channel-1', partId: null }],
  produced: [],
  run: {
    sessionId: 'session-1',
    startedAt: '2026-11-09T08:00:00Z',
    progress: 'running',
  },
  kind: 'prompt',
  prompt: 'Summarize this week and post it.',
  runMode: 'background',
  sends: 'Posts the weekly status summary in #ops',
};

it('reads a running background suggestion with what it will send', () => {
  expect(toSuggestion(WIRE)).toEqual({
    id: 'suggestion-1',
    kind: 'prompt',
    runMode: 'background',
    prompt: 'Summarize this week and post it.',
    sends: 'Posts the weekly status summary in #ops',
    run: {
      sessionId: 'session-1',
      startedAt: '2026-11-09T08:00:00Z',
      progress: 'running',
    },
    title: 'Post the weekly status summary',
    summary: 'This week has none.',
    importance: 80,
    categories: ['important'],
    state: 'accepted',
    createdAt: '2026-11-09T06:00:00Z',
    stateChangedAt: '2026-11-09T08:00:00Z',
    updatedAt: '2026-11-09T08:00:00Z',
    about: [{ entityType: 'channel', entityId: 'channel-1' }],
    produced: [],
  });
});

it('treats a run the server could not read, or one it calls paused, as running', () => {
  for (const progress of [
    'unknown',
    'needs_approval',
    'needs_input',
  ] as const) {
    const suggestion = toSuggestion({
      ...WIRE,
      run: { sessionId: 's', startedAt: '', progress },
    });

    expect(suggestion && suggestionStatus(suggestion)).toBe('running');
  }
});

it('keeps a reply suggestion’s draft as the thread with the draft as its part', () => {
  const suggestion = toSuggestion({
    ...WIRE,
    state: 'proposed',
    run: null,
    kind: 'entity',
    action: 'reply',
    draft: {
      entityType: 'email_thread',
      entityId: 'thread-1',
      partId: 'draft-1',
    },
  });

  expect(suggestion).toMatchObject({
    kind: 'entity',
    action: 'reply',
    draft: {
      entityType: 'email_thread',
      entityId: 'thread-1',
      partId: 'draft-1',
    },
  });
});

it('leaves out suggestions the feed never shows', () => {
  expect(toSuggestion({ ...WIRE, state: 'dismissed' })).toBeUndefined();
  expect(toSuggestion({ ...WIRE, state: 'retired' })).toBeUndefined();
});

it('lists open suggestions, then the ones done lately', () => {
  const open = { ...WIRE, id: 'open', state: 'proposed', run: null } as const;
  const done = { ...WIRE, id: 'done', state: 'done' } as const;

  const suggestions = toSuggestions({ suggestions: [open], done: [done] });

  expect(
    suggestions.map((suggestion) => [suggestion.id, suggestion.state])
  ).toEqual([
    ['open', 'proposed'],
    ['done', 'done'],
  ]);
});
