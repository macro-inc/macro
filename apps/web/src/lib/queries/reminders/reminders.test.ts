import type { EntityData } from '@entity';
import type { Reminder } from '@service-storage/generated/schemas/reminder';
import { describe, expect, it } from 'vitest';
import {
  reminderEntityType,
  reminderSoupPatch,
  reminderTarget,
} from './reminders';

const entity = (type: EntityData['type'], id = 'e1') =>
  ({ type, id, name: 'Thing' }) as EntityData;

const threadEntity = (channelId = 'chan-1', id = 'msg-1') =>
  ({
    type: 'channel_thread',
    id,
    channelId,
    name: 'Channel thread',
  }) as EntityData;

describe('reminderEntityType', () => {
  it('maps frontend types onto their backend names', () => {
    expect(reminderEntityType('document')).toBe('document');
    expect(reminderEntityType('email')).toBe('email_thread');
    expect(reminderEntityType('channel')).toBe('channel');
  });

  it('has no mapping for types a reminder cannot attach to', () => {
    expect(reminderEntityType('channel_message')).toBeUndefined();
    expect(reminderEntityType('channel_thread')).toBeUndefined();
    expect(reminderEntityType('automation')).toBeUndefined();
  });
});

describe('reminderTarget', () => {
  it('pairs a supported type with the entity id', () => {
    expect(reminderTarget(entity('document', 'doc-1'))).toEqual({
      entityType: 'document',
      entityId: 'doc-1',
    });
  });

  // The whole reason type and id resolve together: a thread attaches to its
  // parent channel, so the id is the channel's, not the row's own message id.
  it('attaches a thread row to its parent channel', () => {
    expect(reminderTarget(threadEntity('chan-9', 'msg-7'))).toEqual({
      entityType: 'channel',
      entityId: 'chan-9',
    });
  });

  it('does not send the thread row id under the channel type', () => {
    expect(reminderTarget(threadEntity('chan-9', 'msg-7'))?.entityId).not.toBe(
      'msg-7'
    );
  });

  it('is undefined for types with no reminder target', () => {
    expect(reminderTarget(entity('channel_message'))).toBeUndefined();
    expect(reminderTarget(entity('automation'))).toBeUndefined();
  });
});

describe('reminderSoupPatch', () => {
  const reminder = (overrides: Partial<Reminder> = {}) =>
    ({
      id: 'rem-1',
      description: 'Chase the contract',
      schedule: { type: 'once', remindAt: '2026-08-20T09:00:00.000Z' },
      nextRunAt: '2026-08-20T09:00:00.000Z',
      enabled: true,
      createdAt: '2026-08-01T09:00:00.000Z',
      updatedAt: '2026-08-11T09:00:00.000Z',
      ...overrides,
    }) as Reminder;

  // Soup rows come from the normalized soup cache, not the reminders queries,
  // so without this an edited row keeps its old text until a reload.
  it('projects the edited fields onto the soup row', () => {
    const patch = reminderSoupPatch(reminder({ description: 'Follow up' }), 0);

    expect(patch.tag).toBe('reminder');
    expect(patch.data).toMatchObject({
      id: 'rem-1',
      description: 'Follow up',
      nextRunAt: '2026-08-20T09:00:00.000Z',
      schedule: { type: 'once', remindAt: '2026-08-20T09:00:00.000Z' },
    });
  });

  // The cache merges field by field, so an omitted key would leave a stale
  // completedAt behind and keep a rescheduled reminder filed under Done.
  it('writes an absent completion as an explicit null', () => {
    expect(reminderSoupPatch(reminder(), 0).data).toHaveProperty(
      'completedAt',
      null
    );
  });

  it('keeps a completion that is still set', () => {
    const patch = reminderSoupPatch(
      reminder({ completedAt: '2026-08-10T09:00:00.000Z' }),
      0
    );

    expect(patch.data).toHaveProperty(
      'completedAt',
      '2026-08-10T09:00:00.000Z'
    );
  });

  it("preserves the row's existing frecency score", () => {
    expect(reminderSoupPatch(reminder(), 42).frecency_score).toBe(42);
  });

  it('defaults the frecency score for a row not in the cache', () => {
    expect(reminderSoupPatch(reminder(), undefined).frecency_score).toBe(0);
  });
});
