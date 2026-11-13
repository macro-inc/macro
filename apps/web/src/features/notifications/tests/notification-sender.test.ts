import { describe, expect, it } from 'vitest';
import {
  getNotificationAgentSender,
  getNotificationUserSenderId,
} from '../notification-sender';
import type { UnifiedNotification } from '../types';

const manual = (content: Record<string, unknown>, senderId: string | null) =>
  ({
    id: 'n',
    entity_type: 'document',
    entity_id: 'task',
    sender_id: senderId,
    notification_metadata: { tag: 'ping', content },
  }) as unknown as UnifiedNotification;

describe('who a ping is from', () => {
  it('is its agent alone when an agent sent it for a user', () => {
    const ping = manual(
      { title: 'Deploy finished', agent: { id: 'bot', name: 'Scout' } },
      'macro|ana@example.com'
    );
    expect(getNotificationAgentSender(ping)).toEqual({
      name: 'Scout',
      avatarUrl: undefined,
    });
    expect(getNotificationUserSenderId(ping)).toBeUndefined();
  });

  it('is the sending user when no agent sent it', () => {
    const ping = manual({ title: 'Invoice sent' }, 'macro|ana@example.com');
    expect(getNotificationAgentSender(ping)).toBeUndefined();
    expect(getNotificationUserSenderId(ping)).toBe('macro|ana@example.com');
  });

  it('is nobody when people notify themselves without an agent', () => {
    expect(
      getNotificationUserSenderId(manual({ title: 'Reminder to self' }, null))
    ).toBeUndefined();
  });

  it('leaves other kinds with their sender', () => {
    const comment = {
      id: 'n',
      sender_id: 'macro|ana@example.com',
      notification_metadata: { tag: 'commented_on_document', content: {} },
    } as unknown as UnifiedNotification;
    expect(getNotificationUserSenderId(comment)).toBe('macro|ana@example.com');
  });
});
