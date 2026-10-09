import type { AgentDmConversationResponse } from '@service-agent-harness/direct-messages';
import { type Accessor, createContext, useContext } from 'solid-js';

/**
 * The durable state of a private agent conversation: its contexts and the
 * attempt behind each message. The agent's replies are ordinary channel
 * messages, and what it is doing right now arrives as its typing.
 */
export type AgentDmContextValue = {
  conversation: Accessor<AgentDmConversationResponse | undefined>;
  refresh: () => void;
};

export const AgentDmContext = createContext<AgentDmContextValue>();
export const useOptionalAgentDm = () => useContext(AgentDmContext);
