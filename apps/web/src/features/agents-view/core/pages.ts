/** Pages shown in the Agents workspace in place of a conversation. */
export type AgentsPage = 'new' | 'agents' | 'routines' | 'connections';

export function parseAgentsPage(value: unknown): AgentsPage | undefined {
  if (
    value === 'new' ||
    value === 'agents' ||
    value === 'routines' ||
    value === 'connections'
  )
    return value;
}
