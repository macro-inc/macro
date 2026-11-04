import type { UnifiedNotification } from '@notifications/types';
import { describe, expect, it } from 'vitest';
import { agentTurnParams } from './notification-location';

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
