import type { AgentKind } from './agent-kind';

/**
 * Lines the new-conversation heading types out, in order. The first line is
 * also the heading's accessible name, so it stays the canonical prompt.
 */
export const CHAT_GREETINGS: readonly string[] = [
  'What should we work on?',
  "What's on your plate today?",
  'Where should we start?',
  'What can I take off your hands?',
  'What needs doing?',
];

const CODING_GREETINGS: readonly string[] = [
  'What should we build?',
  'What should we ship today?',
  'Which bug should we squash?',
  'What should we refactor?',
  'What should we fix next?',
];

export function greetingsFor(kind: AgentKind): readonly string[] {
  return kind === 'coder' ? CODING_GREETINGS : CHAT_GREETINGS;
}
