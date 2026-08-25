import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import { describe, expect, it } from 'vitest';
import { mergeListChannel } from '../list-cache';

describe('mergeListChannel', () => {
  const listed = (over: Partial<ApiChannelWithLatest>): ApiChannelWithLatest =>
    ({
      id: 'channel-1',
      name: 'Existing',
      channel_type: 'private',
      owner_id: 'macro|owner@macro.com',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      auto_join_team: false,
      is_participant: true,
      participants: [],
      ...over,
    }) as ApiChannelWithLatest;

  it('does not invent a list when the query has never loaded', () => {
    expect(
      mergeListChannel(undefined, { id: 'channel-new', name: 'New' })
    ).toBeUndefined();
  });

  it('prepends a stub when the channel is missing', () => {
    const existing = listed({});
    const next = mergeListChannel([existing], {
      id: 'channel-new',
      name: 'Created',
      channel_type: 'team',
    });

    expect(next).toHaveLength(2);
    expect(next?.[0]).toMatchObject({
      id: 'channel-new',
      name: 'Created',
      channel_type: 'team',
      is_participant: true,
    });
    expect(next?.[1]).toBe(existing);
  });

  it('patches the name of an existing row without replacing the rest', () => {
    const existing = listed({ owner_id: 'macro|keep@macro.com' });
    const next = mergeListChannel([existing], {
      id: 'channel-1',
      name: 'Renamed',
    });

    expect(next).toHaveLength(1);
    expect(next?.[0]).toMatchObject({
      id: 'channel-1',
      name: 'Renamed',
      owner_id: 'macro|keep@macro.com',
      channel_type: 'private',
    });
  });

  it('returns the same array when the row already matches', () => {
    const existing = listed({ name: 'Same' });
    const channels = [existing];

    expect(mergeListChannel(channels, { id: 'channel-1', name: 'Same' })).toBe(
      channels
    );
  });
});
