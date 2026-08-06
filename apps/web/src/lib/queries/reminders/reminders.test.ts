import type { EntityData } from '@entity';
import { describe, expect, it } from 'vitest';
import { reminderEntityType, reminderTarget } from './reminders';

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
