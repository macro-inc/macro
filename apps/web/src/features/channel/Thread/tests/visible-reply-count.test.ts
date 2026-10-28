import { senderFromStorageId } from '@queries/messages/message-sender';
import { describe, expect, it } from 'vitest';
import type { GroupableMessage } from '../../Channel/message-grouping-meta';
import {
  getCollapsedRepliesCount,
  getUniqueReplyUserIds,
  getVisibleReplyCount,
} from '../utils/thread-reply-indicator-helpers';

function repliesFromSenders(senders: string[]): GroupableMessage[] {
  return senders.map((senderId, index) => ({
    id: `reply-${index}`,
    sender_id: senderId,
    sender: senderFromStorageId(senderId),
    created_at: new Date(Date.UTC(2026, 8, 24, 9, index)).toISOString(),
    attachments: [],
    deleted_at: null,
  }));
}

describe('collapsed reply groups', () => {
  it('shows no replies for an empty thread', () => {
    expect(getVisibleReplyCount([])).toBe(0);
  });

  it('keeps a long run from one sender fully visible', () => {
    const replies = repliesFromSenders(Array(10).fill('user-a'));
    const visibleCount = getVisibleReplyCount(replies);
    expect(visibleCount).toBe(10);
    expect(getCollapsedRepliesCount(replies.length, visibleCount)).toBe(0);
  });

  it('shows exactly three complete groups and counts only hidden replies', () => {
    const replies = repliesFromSenders([
      'user-a',
      'user-a',
      'user-b',
      'user-b',
      'user-c',
      'user-c',
      'user-d',
      'user-d',
    ]);
    const visibleCount = getVisibleReplyCount(replies);
    expect(visibleCount).toBe(6);
    expect(getCollapsedRepliesCount(replies.length, visibleCount)).toBe(2);
    expect(getUniqueReplyUserIds(replies.slice(visibleCount))).toEqual([
      'user-d',
    ]);
  });

  it('counts a returning sender as a new group', () => {
    const replies = repliesFromSenders([
      'user-a',
      'user-b',
      'user-a',
      'user-b',
    ]);
    expect(getVisibleReplyCount(replies)).toBe(3);
  });

  it('keeps replies at the five-minute boundary together but splits longer gaps', () => {
    const replies = repliesFromSenders(Array(5).fill('user-a'));
    const minutes = [0, 5, 11, 17, 23];
    replies.forEach((reply, index) => {
      reply.created_at = new Date(
        Date.UTC(2026, 8, 24, 9, minutes[index])
      ).toISOString();
    });
    expect(getVisibleReplyCount(replies)).toBe(4);
  });

  it('respects deleted-message group boundaries', () => {
    const replies = repliesFromSenders(Array(5).fill('user-a'));
    replies[1].deleted_at = replies[1].created_at;
    replies[3].deleted_at = replies[3].created_at;
    expect(getVisibleReplyCount(replies)).toBe(3);
  });

  it('separates agent replies triggered by different users', () => {
    const replies = repliesFromSenders(Array(5).fill('bot|macro'));
    const triggers = ['user-a', 'user-a', 'user-b', 'user-c', 'user-d'];
    replies.forEach((reply, index) => {
      reply.sender = {
        type: 'bot',
        id: 'macro',
        name: 'Macro',
        triggered_by: triggers[index],
      };
    });
    expect(getVisibleReplyCount(replies)).toBe(4);
  });

  it('extends a truncated preview when more replies in the group load', () => {
    const replies = repliesFromSenders([
      'user-a',
      'user-a',
      'user-a',
      'user-a',
      'user-b',
      'user-c',
      'user-d',
    ]);
    expect(getVisibleReplyCount(replies.slice(0, 3))).toBe(3);
    expect(getVisibleReplyCount(replies)).toBe(6);
  });
});
