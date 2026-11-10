import type { Idea } from '../core/idea';

const BASE = {
  importance: 50,
  categories: [],
  state: 'proposed' as const,
  createdAt: '2026-11-09T04:00:00Z',
  stateChangedAt: '2026-11-09T06:00:00Z',
  about: [],
  produced: [],
};

export const composerIdea: Idea = {
  ...BASE,
  id: 'idea-composer',
  createdAt: '2026-11-09T06:00:00Z',
  kind: 'prompt',
  runMode: 'composer',
  title: 'Prepare the budget review',
  summary: 'Two finance threads mention it; nothing is prepared yet.',
  prompt: 'Draft a one-page brief for the budget review.',
};

export const backgroundIdea: Idea = {
  ...BASE,
  id: 'idea-background',
  kind: 'prompt',
  runMode: 'background',
  title: 'Post the weekly status summary',
  summary: 'The team posts one every Friday; this week has none.',
  prompt: 'Summarize this week and post it.',
  sends: 'Posts the weekly status summary in #ops',
};

export const quietBackgroundIdea: Idea = {
  ...BASE,
  id: 'idea-quiet',
  kind: 'prompt',
  runMode: 'background',
  title: 'Research the vendor before the call',
  summary: 'The call is Thursday and there are no notes on them yet.',
  prompt: 'Research the vendor and write a one-page brief.',
};

export const runningIdea: Idea = {
  ...backgroundIdea,
  id: 'idea-running',
  state: 'accepted',
  run: {
    sessionId: 'session-1',
    startedAt: '2026-11-09T08:00:00Z',
    progress: 'running',
  },
};

export const failedIdea: Idea = {
  ...backgroundIdea,
  id: 'idea-failed',
  state: 'accepted',
  run: {
    sessionId: 'session-2',
    startedAt: '2026-11-09T08:00:00Z',
    progress: 'failed',
  },
};

export const doneIdea: Idea = {
  ...backgroundIdea,
  id: 'idea-done',
  state: 'done',
  stateChangedAt: '2026-11-09T08:05:00Z',
  run: {
    sessionId: 'session-3',
    startedAt: '2026-11-09T08:00:00Z',
    progress: 'finished',
  },
  produced: [
    { entityType: 'agent_session', entityId: 'session-3' },
    { entityType: 'document', entityId: 'document-1' },
  ],
};

export const replyIdea: Idea = {
  ...BASE,
  id: 'idea-reply',
  kind: 'entity',
  action: 'reply',
  title: 'Reply about the invoice',
  summary: 'They asked for approval before Friday; nobody has replied.',
  about: [{ entityType: 'email_thread', entityId: 'thread-1' }],
};

export const draftedReplyIdea: Idea = {
  ...replyIdea,
  id: 'idea-drafted-reply',
  title: 'Reply to the renewal question',
  summary: 'They asked whether the renewal terms changed; a reply is ready.',
  draft: {
    entityType: 'email_thread',
    entityId: 'thread-1',
    partId: 'draft-1',
  },
};

export const routineIdea: Idea = {
  ...BASE,
  id: 'idea-routine',
  kind: 'routine',
  routineSuggestionId: 'suggestion-1',
  title: 'Weekly vendor digest',
  summary: '',
};
