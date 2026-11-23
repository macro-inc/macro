import { codeSteps, type StepDraft } from './routine-steps';

/** How AI takes part in a routine, shown as a chip before what it does. */
export type WorkChip = 'Ask AI';

/** What a routine does in a line, for its row in the routines list. */
export type WorkSummary = { chip?: WorkChip; text: string };

const MENTION = /<m-[a-z-]+>(\{.*?\})<\/m-[a-z-]+>/g;

/** Mentions as the names they show, so instructions read as plain text. */
function plainText(instructions: string): string {
  return instructions.replace(MENTION, (_, json: string) => {
    try {
      const data = JSON.parse(json) as Record<string, unknown>;
      const name =
        data.documentName ?? data.displayName ?? data.name ?? data.email;
      return typeof name === 'string' ? name : '';
    } catch {
      return '';
    }
  });
}

/** The gist of an agent's instructions: their first clause or sentence. */
export function instructionsGist(instructions: string): string {
  const [line = ''] = plainText(instructions)
    .split('\n')
    .map((part) => part.trim())
    .filter(Boolean);
  const clause = line.split(/(?<=[^\d])[.:;!?](?:\s|$)/)[0]?.trim() ?? '';
  return clause || line;
}

/**
 * A routine's work in a line: its code steps' titles, or the gist of what it
 * asks AI.
 */
export function summarizeWork(
  steps: StepDraft[] | undefined,
  prompt: string
): WorkSummary {
  if (!steps) return { chip: 'Ask AI', text: instructionsGist(prompt) };
  const titles = codeSteps(steps)
    .map((step) => step.title.trim())
    .filter(Boolean)
    .join(' · ');
  const agent = steps.find((step) => step.kind === 'agent');
  if (agent?.kind === 'agent')
    return {
      chip: 'Ask AI',
      text: titles || instructionsGist(agent.instructions),
    };
  return { text: titles || 'No steps' };
}
