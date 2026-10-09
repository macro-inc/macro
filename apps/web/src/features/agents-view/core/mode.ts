/** Session kind used for routes and the agent workspace's presentation. */
export type AgentsMode = 'chat' | 'code';

/** The workspace switch calls chat agents "Work" and coding agents "Code". */
export function agentsModeLabel(mode: AgentsMode): string {
  return mode === 'code' ? 'Code' : 'Work';
}
