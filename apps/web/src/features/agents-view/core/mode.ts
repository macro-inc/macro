/**
 * The two halves of the Agents workspace. Chat talks to agents that answer in
 * Macro; Code hands work to coders that run on a coding runtime and open pull
 * requests. The same rows, agents, and composer show up in both; the mode only
 * decides which half of them is in view.
 */
export type AgentsMode = 'chat' | 'code';

/** Reads a stored or hinted mode, falling back to Chat for anything unknown. */
export function parseAgentsMode(value: unknown): AgentsMode {
  return value === 'code' ? 'code' : 'chat';
}
