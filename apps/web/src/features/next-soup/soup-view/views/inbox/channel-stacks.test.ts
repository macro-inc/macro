import {
  buildFlatSoupRows,
  buildGroupedSoupRows,
} from '@app/features/soup/collection/rows';
import type { EntityData, Notification } from '@entity';
import { describe, expect, it } from 'vitest';
import {
  clusterInboxChannelEntities,
  inboxChannelStacksByRowId,
  inboxStackFollowerText,
} from './channel-stacks';

const channel = (id: string) =>
  ({ id, type: 'channel', name: `#${id}` }) as unknown as EntityData;

const thread = (id: string, channelId: string) =>
  ({
    id,
    type: 'channel_thread',
    channelId,
    messageId: id,
    name: `#${channelId}`,
  }) as unknown as EntityData;

const document = (id: string) =>
  ({ id, type: 'document', name: id }) as unknown as EntityData;

const notification = (tag: string) =>
  ({ notification_metadata: { tag } }) as unknown as Notification;

const ids = (entities: EntityData[]) => entities.map((entity) => entity.id);

describe('clusterInboxChannelEntities', () => {
  it('pulls a channel’s rows up to its newest one', () => {
    const clustered = clusterInboxChannelEntities([
      channel('feature-requests'),
      document('spec'),
      thread('mention', 'feature-requests'),
    ]);

    expect(ids(clustered)).toEqual(['feature-requests', 'mention', 'spec']);
  });

  it('leaves rows that share no channel where the feed put them', () => {
    const entities = [document('spec'), channel('eng'), document('notes')];

    expect(ids(clusterInboxChannelEntities(entities))).toEqual(ids(entities));
  });

  it('keeps separate channels apart and in arrival order', () => {
    const clustered = clusterInboxChannelEntities([
      channel('eng'),
      thread('a', 'design'),
      thread('b', 'eng'),
      channel('design'),
    ]);

    expect(ids(clustered)).toEqual(['eng', 'b', 'a', 'design']);
  });

  it('drops no rows', () => {
    const entities = [
      channel('eng'),
      document('spec'),
      thread('a', 'eng'),
      thread('b', 'design'),
    ];

    expect(clusterInboxChannelEntities(entities)).toHaveLength(entities.length);
  });
});

describe('inboxChannelStacksByRowId', () => {
  it('nests a channel’s later rows under its first', () => {
    const rows = buildFlatSoupRows(
      clusterInboxChannelEntities([
        channel('eng'),
        thread('a', 'eng'),
        thread('b', 'eng'),
      ])
    );
    const stacks = inboxChannelStacksByRowId(rows);

    expect(rows.map((row) => stacks.get(row.id)?.index)).toEqual([0, 1, 2]);
  });

  it('leaves a channel that appears once unstacked', () => {
    const rows = buildFlatSoupRows([channel('eng'), document('spec')]);

    expect(inboxChannelStacksByRowId(rows).size).toBe(0);
  });

  it('does not stack across a date group', () => {
    const rows = buildGroupedSoupRows([
      { id: 'today', label: 'Today', entities: [channel('eng')] },
      { id: 'yesterday', label: 'Yesterday', entities: [thread('a', 'eng')] },
    ]);

    expect(inboxChannelStacksByRowId(rows).size).toBe(0);
  });
});

describe('inboxStackFollowerText', () => {
  it('says what a nested channel row is instead of repeating where', () => {
    expect(
      inboxStackFollowerText(
        thread('a', 'eng'),
        notification('channel_mention')
      )
    ).toEqual({ label: 'Mentioned you', action: 'mentioned you' });
    expect(inboxStackFollowerText(channel('eng'))?.label).toBe('New messages');
  });

  it('leaves rows it has no better title for alone', () => {
    expect(inboxStackFollowerText(document('spec'))).toBeUndefined();
    expect(
      inboxStackFollowerText(thread('a', 'eng'), notification('call_started'))
    ).toBeUndefined();
  });
});
