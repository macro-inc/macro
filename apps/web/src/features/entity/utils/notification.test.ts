import { describe, expect, it } from 'vitest';
import { isMentionsOnlyItem, isMutedItem } from './notification';

const CHANNEL = { item_id: 'channel-one', item_type: 'channel' };

describe('item notification preferences', () => {
  it('treats a mentions-only channel as notifying, not muted', () => {
    const preferences = [{ ...CHANNEL, mentions_only: true }];
    expect(isMentionsOnlyItem(preferences, CHANNEL)).toBe(true);
    expect(isMutedItem(preferences, CHANNEL)).toBe(false);
  });

  it('treats a mute as muted, not mentions only', () => {
    const preferences = [{ ...CHANNEL, snoozed_until: null }];
    expect(isMutedItem(preferences, CHANNEL)).toBe(true);
    expect(isMentionsOnlyItem(preferences, CHANNEL)).toBe(false);
  });

  it('reports neither for other channels or an expired snooze', () => {
    const preferences = [
      { ...CHANNEL, snoozed_until: '2000-01-01T00:00:00Z' },
      { item_id: 'channel-two', item_type: 'channel', mentions_only: true },
    ];
    expect(isMutedItem(preferences, CHANNEL)).toBe(false);
    expect(isMentionsOnlyItem(preferences, CHANNEL)).toBe(false);
  });
});
