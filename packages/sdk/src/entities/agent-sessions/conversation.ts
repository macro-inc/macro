import type {
  AgentConversationDto,
  AgentConversationTurnDto,
} from '../../../generated/agent-harness/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Agent } from '../agents/agent';
import type { Channel } from '../channels/channel';
import { Message } from '../channels/message';
import { AgentSession } from './agent-session';

/** An agent's conversation in one channel. */
export class AgentConversation {
  constructor(
    private readonly client: MacroClient,
    /** Parent channel. */
    readonly channel: Channel,
    private readonly record: AgentConversationDto,
  ) {}

  /** The agent taking part. */
  agent(): Agent {
    return Agent.byId(this.client, this.record.botId);
  }

  /** Conversation sessions with their current flag. */
  sessions() {
    return this.record.sessions.map((s) => ({
      session: AgentSession.byId(this.client, s.sessionId),
      isCurrent: s.isCurrent,
      createdAt: s.createdAt,
    }));
  }

  /** Recorded conversation turns. */
  turns(): ConversationTurn[] {
    return this.record.turns.map(
      (t) => new ConversationTurn(this.client, this, t),
    );
  }

  /** Start a fresh conversation from one of its sessions. */
  async startFresh(session: AgentSession): Promise<void> {
    unwrap(
      await this.client.agentHarness.startFreshAgentConversation({
        path: { channel_id: this.channel.id, bot_id: this.record.botId },
        body: { sessionId: session.id },
      }),
    );
  }

  /** Serialize scoped identity. */
  toJSON() {
    return { channelId: this.channel.id, agentId: this.record.botId };
  }
}

/** One agent conversation turn, identified by its source message. */
export class ConversationTurn {
  constructor(
    private readonly client: MacroClient,
    /** Parent conversation. */
    readonly conversation: AgentConversation,
    private readonly record: AgentConversationTurnDto,
  ) {}

  /** Originating message. */
  source(): Message {
    return Message.byId(
      this.client,
      this.conversation.channel.id,
      this.record.sourceMessageId,
    );
  }

  /** Session that handled this turn. */
  session(): AgentSession {
    return AgentSession.byId(this.client, this.record.sessionId);
  }

  /** Retry with a caller persisted action nonce. Never retries automatically. */
  async retry(actionId: string): Promise<void> {
    unwrap(
      await this.client.agentHarness.retryAgentConversationTurn({
        path: {
          channel_id: this.conversation.channel.id,
          bot_id: this.conversation.agent().id,
          source: this.record.sourceMessageId,
        },
        body: { actionId },
      }),
    );
  }

  /** Serialize scoped identity. */
  toJSON() {
    return {
      channelId: this.conversation.channel.id,
      sourceMessageId: this.record.sourceMessageId,
    };
  }
}
