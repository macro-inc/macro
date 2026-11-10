import type { Idea as WireIdea } from '@service-scheduled-action/generated/schemas';
import { expect, it } from 'vitest';
import { ideaStatus } from '../core/idea';
import { toIdea, toIdeas } from './decode';

const WIRE: WireIdea = {
  id: 'idea-1',
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

it('reads a running background idea with what it will send', () => {
  expect(toIdea(WIRE)).toEqual({
    id: 'idea-1',
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
    const idea = toIdea({
      ...WIRE,
      run: { sessionId: 's', startedAt: '', progress },
    });

    expect(idea && ideaStatus(idea)).toBe('running');
  }
});

it('keeps a reply idea’s draft as the thread with the draft as its part', () => {
  const idea = toIdea({
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

  expect(idea).toMatchObject({
    kind: 'entity',
    action: 'reply',
    draft: {
      entityType: 'email_thread',
      entityId: 'thread-1',
      partId: 'draft-1',
    },
  });
});

it('leaves out ideas the feed never shows', () => {
  expect(toIdea({ ...WIRE, state: 'dismissed' })).toBeUndefined();
  expect(toIdea({ ...WIRE, state: 'retired' })).toBeUndefined();
});

it('lists open ideas, then the ones done lately', () => {
  const open = { ...WIRE, id: 'open', state: 'proposed', run: null } as const;
  const done = { ...WIRE, id: 'done', state: 'done' } as const;

  const ideas = toIdeas({ ideas: [open], done: [done] });

  expect(ideas.map((idea) => [idea.id, idea.state])).toEqual([
    ['open', 'proposed'],
    ['done', 'done'],
  ]);
});
