import type { AgentConversation } from '@service-agent-harness/agent-conversations';
import { type Accessor, createContext, useContext } from 'solid-js';

/**
 * The durable state of the agent conversations in a channel: each agent's
 * sessions and the attempt behind each message it answers. The agents'
 * replies are ordinary channel messages, and what an agent is doing right now
 * arrives as its typing.
 */
export type AgentConversationsContextValue = {
  conversations: Accessor<AgentConversation[] | undefined>;
  refresh: () => void;
};

export const AgentConversationsContext =
  createContext<AgentConversationsContextValue>();
export const useOptionalAgentConversations = () =>
  useContext(AgentConversationsContext);
