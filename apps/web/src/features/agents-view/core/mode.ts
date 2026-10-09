/** Session kind used for routes and the agent workspace's presentation. */
export type AgentsMode = 'chat' | 'code';

/** The composer's mode switch calls chat agents "Chat" and coding agents "Code". */
export function agentsModeLabel(mode: AgentsMode): string {
  return mode === 'code' ? 'Code' : 'Chat';
}
