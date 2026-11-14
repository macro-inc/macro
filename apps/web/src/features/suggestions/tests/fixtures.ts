import type { Suggestion } from '../core/suggestion';

const BASE = {
  importance: 50,
  categories: [],
  status: 'open' as const,
  isNew: false,
  createdAt: '2026-11-09T04:00:00Z',
  stateChangedAt: '2026-11-09T06:00:00Z',
  updatedAt: '2026-11-09T06:00:00Z',
  about: [],
};

export const composerSuggestion: Suggestion = {
  ...BASE,
  id: 'suggestion-composer',
  createdAt: '2026-11-09T06:00:00Z',
  kind: 'prompt',
  runMode: 'composer',
  title: 'Prepare the budget review',
  summary: 'Two finance threads mention it; nothing is prepared yet.',
  prompt: 'Draft a one-page brief for the budget review.',
};

export const backgroundSuggestion: Suggestion = {
  ...BASE,
  id: 'suggestion-background',
  kind: 'prompt',
  runMode: 'background',
  title: 'Post the weekly status summary',
  summary: 'The team posts one every Friday; this week has none.',
  prompt: 'Summarize this week and post it.',
  sends: 'Posts the weekly status summary in #ops',
};

export const quietBackgroundSuggestion: Suggestion = {
  ...BASE,
  id: 'suggestion-quiet',
  kind: 'prompt',
  runMode: 'background',
  title: 'Research the vendor before the call',
  summary: 'The call is Thursday and there are no notes on them yet.',
  prompt: 'Research the vendor and write a one-page brief.',
};

export const runningSuggestion: Suggestion = {
  ...backgroundSuggestion,
  id: 'suggestion-running',
  status: 'running',
  run: { sessionId: 'session-1', startedAt: '2026-11-09T08:00:00Z' },
};

export const failedSuggestion: Suggestion = {
  ...backgroundSuggestion,
  id: 'suggestion-failed',
  status: 'failed',
  run: { sessionId: 'session-2', startedAt: '2026-11-09T08:00:00Z' },
};

export const doneSuggestion: Suggestion = {
  ...backgroundSuggestion,
  id: 'suggestion-done',
  status: 'done',
  stateChangedAt: '2026-11-09T08:05:00Z',
  run: { sessionId: 'session-3', startedAt: '2026-11-09T08:00:00Z' },
  result: { entityType: 'document', entityId: 'document-1' },
};

export const replySuggestion: Suggestion = {
  ...BASE,
  id: 'suggestion-reply',
  kind: 'entity',
  action: 'reply',
  title: 'Reply about the invoice',
  summary: 'They asked for approval before Friday; nobody has replied.',
  about: [{ entityType: 'email_thread', entityId: 'thread-1' }],
  from: 'Priya Shah',
  waitingSince: '2026-11-07T09:00:00Z',
};

export const draftedReplySuggestion: Suggestion = {
  ...replySuggestion,
  id: 'suggestion-drafted-reply',
  title: 'Reply to the renewal question',
  summary: 'They asked whether the renewal terms changed; a reply is ready.',
  draft: {
    entityType: 'email_thread',
    entityId: 'thread-1',
    partId: 'draft-1',
    preview: 'The terms are unchanged; only the price moved.',
  },
};

export const routineSuggestion: Suggestion = {
  ...BASE,
  id: 'suggestion-routine',
  kind: 'routine',
  routineSuggestionId: 'routine-draft-1',
  title: 'Weekly vendor digest',
  summary: '',
  routine: {
    sentence: [
      { text: 'Every ', picked: false },
      { text: 'Friday', picked: true },
      { text: ' at ', picked: false },
      { text: '9:00 AM', picked: true },
      {
        text: ', list the deliveries vendors confirmed this week and post it to ',
        picked: false,
      },
      { text: '#ops', picked: true },
      { text: '.', picked: false },
    ],
    when: 'Fridays at 9:00 AM',
  },
};
