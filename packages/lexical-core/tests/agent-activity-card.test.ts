import { describe, expect, it } from 'vitest';
import { isAgentActivityCard } from '../nodes/AgentActivityNode';

describe('isAgentActivityCard', () => {
  it('accepts the cards a session fold gives its rows', () => {
    expect(
      isAgentActivityCard({
        kind: 'item',
        itemType: 'calendar_event',
        itemId: 'event-1',
        fileType: null,
        action: 'created',
        title: null,
      })
    ).toBe(true);
    expect(
      isAgentActivityCard({
        kind: 'item',
        itemType: 'email_thread',
        itemId: 'thread-1',
        action: 'sent',
      })
    ).toBe(true);
    expect(isAgentActivityCard({ kind: 'view', view: { widgets: [] } })).toBe(
      true
    );
  });

  it('accepts a database answer the agent asked to show', () => {
    expect(
      isAgentActivityCard({
        kind: 'data',
        sql: 'SELECT 1',
        databaseId: null,
        display: 'bar',
      })
    ).toBe(true);
  });

  it('accepts drafts saved for review, by the review and what its drafts are', () => {
    expect(
      isAgentActivityCard({
        kind: 'review',
        reviewId: '0199f3a2-1b2c-7d4e-8f90-a1b2c3d4e5f6',
        drafts: 'calendar',
      })
    ).toBe(true);
    expect(
      isAgentActivityCard({ kind: 'review', reviewId: '', drafts: 'email' })
    ).toBe(false);
    expect(
      isAgentActivityCard({ kind: 'review', reviewId: 'r', drafts: 'memo' })
    ).toBe(false);
  });

  it("leaves out what an older reply's searches found, which no longer shows", () => {
    expect(
      isAgentActivityCard({
        kind: 'sources',
        query: 'lumen pricing',
        total: 1,
        sources: [{ kind: 'web', url: 'https://lumen.example/blog' }],
      })
    ).toBe(false);
    expect(isAgentActivityCard({ kind: 'data', sql: '' })).toBe(false);
  });

  it('refuses a card it cannot show', () => {
    expect(isAgentActivityCard(null)).toBe(false);
    expect(isAgentActivityCard({ kind: 'view' })).toBe(false);
    expect(
      isAgentActivityCard({
        kind: 'item',
        itemType: 'spaceship',
        itemId: 'x',
        action: 'created',
      })
    ).toBe(false);
    expect(
      isAgentActivityCard({
        kind: 'item',
        itemType: 'document',
        itemId: '',
        action: 'created',
      })
    ).toBe(false);
    expect(
      isAgentActivityCard({
        kind: 'item',
        itemType: 'document',
        itemId: 'doc-1',
        action: 'launched',
      })
    ).toBe(false);
  });
});
