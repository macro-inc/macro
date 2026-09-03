/** The private context supplied to an agent alongside a channel message. */
export type AgentContextData = {
  version: 1;
  text: string;
};

/** Return whether a value is the supported agent-context payload. */
export function isAgentContextData(value: unknown): value is AgentContextData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return data.version === 1 && typeof data.text === 'string';
}
