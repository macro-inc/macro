import { describe, expect, it, vi } from 'vitest';
import { documentEntry } from '../tests/wire';
import { decodeWorkFeedEntry, encodeWorkFeedScope } from './decode';

// Row mapping imports allBlocks, which loads every block module; one of them
// opens a websocket that jsdom rejects after the test ends.
vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: () => 'Untitled',
  itemToSafeName: (item: { name?: string }) => item.name ?? 'Untitled',
}));

describe('decodeWorkFeedEntry', () => {
  it('decodes an attention entry with its stacked notifications', () => {
    const decoded = decodeWorkFeedEntry(
      documentEntry({
        docId: 'doc-1',
        sortAt: '2026-02-01T10:09:00Z',
        attentionAt: '2026-02-01T10:09:00Z',
        stacks: [
          [{ id: 'n-2', createdAt: '2026-02-01T10:09:00Z' }],
          [{ id: 'n-1', createdAt: '2026-02-01T10:05:00Z', state: 'SEEN' }],
        ],
      })
    );

    expect(decoded?.itemId).toBe('document:doc-1');
    expect(decoded?.sortAt).toBe(Date.parse('2026-02-01T10:09:00Z'));
    expect(decoded?.state).toBe('unseen');
    expect(decoded?.primaryReason).toBe('attention');
    expect(decoded?.hasAttention).toBe(true);
    expect(decoded?.hasOwnWork).toBe(false);
    const entity = decoded?.entity;
    expect(entity?.type).toBe('document');
    expect(entity?.id).toBe('doc-1');
    expect(entity?.sortTs).toBe('2026-02-01T10:09:00Z');
    expect(entity?.notificationDisplayCutoff).toBe('2026-02-01T10:09:00Z');
    const notifications = Array.isArray(entity?.notifications)
      ? entity.notifications
      : [];
    expect(notifications.map((n) => n.id)).toEqual(['n-2', 'n-1']);
    expect(notifications[0].notification_metadata.tag).toBe(
      'commented_on_document'
    );
    expect(notifications[1].state).toBe('seen');
  });

  it('keeps an older comment label off a row whose own work is newer', () => {
    const decoded = decodeWorkFeedEntry(
      documentEntry({
        docId: 'doc-1',
        sortAt: '2026-02-01T10:30:00Z',
        primaryReason: 'OWN_WORK',
        attentionAt: '2026-02-01T10:05:00Z',
        touchedAt: '2026-02-01T10:30:00Z',
        stacks: [[{ id: 'n-1', createdAt: '2026-02-01T10:05:00Z' }]],
      })
    );
    expect(decoded?.primaryReason).toBe('own_work');
    expect(decoded?.hasAttention).toBe(true);
    expect(decoded?.hasOwnWork).toBe(true);
    expect(decoded?.entity.notificationDisplayCutoff).toBe(
      '2026-02-01T10:30:00Z'
    );
    expect(decoded?.entity.touchedAt).toBe('2026-02-01T10:30:00Z');
  });
});

describe('encodeWorkFeedScope', () => {
  it('encodes mode and kinds for the wire', () => {
    expect(
      encodeWorkFeedScope({
        mode: 'attention',
        types: ['channel_thread', 'pull_request'],
        includeSnippets: true,
      })
    ).toEqual({
      mode: 'ATTENTION',
      types: ['CHANNEL_THREAD', 'PULL_REQUEST'],
      includeSnippets: true,
    });
  });
});
