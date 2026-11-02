/** Session kind used for routes and the agent workspace's presentation. */
export type AgentsMode = 'chat' | 'code';

/**
 * The new-conversation composer's choice: a session kind, or Auto, which asks
 * the backend which kind each prompt needs and starts the user's usual agent.
 */
export type ComposerMode = AgentsMode | 'auto';

/** The composer's mode switch calls chat agents "Chat" and coding agents "Code". */
export function agentsModeLabel(mode: ComposerMode): string {
  if (mode === 'auto') return 'Auto';
  return mode === 'code' ? 'Code' : 'Chat';
}
