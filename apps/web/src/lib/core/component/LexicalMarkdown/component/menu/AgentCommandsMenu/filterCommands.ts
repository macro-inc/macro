import type { AgentCommandItem } from '../../../plugins/agent-commands';

/** Keep name-prefix matches ahead of name/description substring matches. */
export function filterCommands(commands: AgentCommandItem[], search: string) {
  const term = search.trim().toLowerCase();
  if (!term) return commands;
  const prefix: AgentCommandItem[] = [];
  const contains: AgentCommandItem[] = [];
  for (const command of commands) {
    const name = command.name.toLowerCase();
    if (name.startsWith(term)) {
      prefix.push(command);
    } else if (
      name.includes(term) ||
      command.description.toLowerCase().includes(term)
    ) {
      contains.push(command);
    }
  }
  return [...prefix, ...contains];
}
