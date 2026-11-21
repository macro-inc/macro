/** Pages shown in the Agents workspace in place of a conversation. */
export type AgentsPage =
  | 'new'
  | 'agents'
  | 'connections'
  | 'routines'
  | 'archived';

export function parseAgentsPage(value: unknown): AgentsPage | undefined {
  if (
    value === 'new' ||
    value === 'agents' ||
    value === 'connections' ||
    value === 'routines' ||
    value === 'archived'
  )
    return value;
}
