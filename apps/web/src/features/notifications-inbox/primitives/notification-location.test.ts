import { COMMENT_LINK_PARAM } from '@core/messages/comment-link';
import type { UnifiedNotification } from '@notifications/types';
import { describe, expect, it } from 'vitest';
import { agentTurnParams, crmCommentParams } from './notification-location';

const notification = (tag: string, content: Record<string, unknown>) =>
  ({
    notification_metadata: { tag, content },
  }) as unknown as UnifiedNotification;

describe('agentTurnParams', () => {
  it('points an agent notification at the turn it is about', () => {
    expect(
      agentTurnParams(notification('agent_session_settled', { turn: 4 }))
    ).toEqual({ agent_message_turn: '4', agent_message_author: 'agent' });
    expect(
      agentTurnParams(
        notification('agent_session_waiting_for_input', { turn: 0 })
      )
    ).toEqual({ agent_message_turn: '0', agent_message_author: 'agent' });
  });

  it('has nothing to add for a notification without a turn', () => {
    expect(
      agentTurnParams(notification('agent_session_mentioned', {}))
    ).toBeUndefined();
    expect(
      agentTurnParams(notification('channel_message_send', {}))
    ).toBeUndefined();
  });
});

describe('crmCommentParams', () => {
  const on = (tag: string) =>
    ({
      notification_metadata: { tag, content: { messageId: 'comment-1' } },
    }) as unknown as UnifiedNotification;

  it('finds the comment a notification on a record is about', () => {
    expect(crmCommentParams(on('crm_discussion'))).toEqual({
      [COMMENT_LINK_PARAM]: 'comment-1',
    });
  });

  it('has nothing to find on anything else, or with no notification', () => {
    expect(crmCommentParams(on('task_assigned'))).toBeUndefined();
    expect(crmCommentParams(undefined)).toBeUndefined();
  });
});
