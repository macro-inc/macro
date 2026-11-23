import { describe, expect, it } from 'vitest';
import { doneSuggestion, replySuggestion } from '../tests/fixtures';
import { draftOrigin, waitingFor } from './suggestion';

describe('waitingFor', () => {
  const now = new Date('2026-11-09T09:30:00Z');

  it('counts whole days, then hours, and nothing under an hour', () => {
    expect(waitingFor('2026-11-07T09:00:00Z', now)).toEqual({
      unit: 'days',
      count: 2,
    });
    expect(waitingFor('2026-11-09T04:00:00Z', now)).toEqual({
      unit: 'hours',
      count: 5,
    });
    expect(waitingFor('2026-11-09T09:00:00Z', now)).toBeUndefined();
    expect(waitingFor('not a date', now)).toBeUndefined();
  });
});

describe('draftOrigin', () => {
  const drafted = {
    ...replySuggestion,
    status: 'done' as const,
    draft: {
      entityType: 'email_thread',
      entityId: 'thread-1',
      partId: 'draft-1',
    },
    about: [
      { entityType: 'email_thread', entityId: 'thread-1' },
      { entityType: 'document', entityId: 'document-9' },
    ],
  };
  const feed = {
    suggestions: [doneSuggestion, drafted],
    counts: { open: 0, running: 0, failed: 0, done: 2 },
  };

  it('finds the suggestion that wrote a draft and leaves its thread out of the sources', () => {
    expect(draftOrigin(feed, 'draft-1')).toEqual({
      suggestionId: drafted.id,
      thread: { entityType: 'email_thread', entityId: 'thread-1' },
      sources: [{ entityType: 'document', entityId: 'document-9' }],
    });
  });

  it('has nothing to say about a draft no suggestion wrote', () => {
    expect(draftOrigin(feed, 'draft-2')).toBeUndefined();
  });
});
