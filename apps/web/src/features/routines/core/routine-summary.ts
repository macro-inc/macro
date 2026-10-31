import { match } from 'ts-pattern';
import {
  type ChooseStepDraft,
  flattenSteps,
  type StepDraft,
} from './routine-steps';
import { actionLabel, pickAction } from './step-catalog';

/** How AI takes part in a routine, shown as a chip before what it does. */
export type WorkChip = 'AI picks' | 'AI decides' | 'Ask AI';

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

/** What a choice picks: "Priority" for a priority pick, else its options. */
function chooseLabel(step: ChooseStepDraft): string {
  return match(pickAction(step))
    .with('set_priority', () => 'Priority')
    .with('set_status', () => 'Status')
    .with('assign', () => 'Owner')
    .with('add_label', () => 'Labels')
    .with('add_tag', () => 'Tags')
    .with(undefined, () =>
      step.options
        .map((option) => option.label.trim())
        .filter(Boolean)
        .join(', ')
    )
    .exhaustive();
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * A routine's work in a line: what AI picks or decides and what follows, the
 * gist of what it asks AI, or its actions.
 */
export function summarizeWork(
  steps: StepDraft[] | undefined,
  prompt: string
): WorkSummary {
  if (!steps) return { chip: 'Ask AI', text: instructionsGist(prompt) };
  const all = flattenSteps(steps);
  const tools = all.filter((step) => step.kind === 'tool');
  const chooses = all.filter(
    (step): step is ChooseStepDraft => step.kind === 'choose'
  );
  const agent = all.find((step) => step.kind === 'agent');
  if (chooses.length) {
    // A pick's options each set the value it picks; those are the pick.
    const inPicks = new Set(
      chooses
        .filter((step) => pickAction(step))
        .flatMap((step) =>
          flattenSteps(step.options.flatMap((option) => option.steps))
        )
        .map((step) => step.id)
    );
    const rest = tools.filter((step) => !inPicks.has(step.id));
    const plain = chooses.filter((step) => !pickAction(step));
    // Options of a plain choice run different actions: count them. After
    // picks alone, name what follows.
    const after = plain.length
      ? rest.length
        ? plural(rest.length, 'action')
        : ''
      : [
          ...new Set(
            rest.flatMap((step) =>
              step.kind === 'tool' ? [actionLabel(step)] : []
            )
          ),
        ].join(' · ');
    return {
      chip: 'AI picks',
      text: [chooses.map(chooseLabel).filter(Boolean).join(', '), after]
        .filter(Boolean)
        .join(' · '),
    };
  }
  const actions = [
    ...new Set(
      tools.flatMap((step) => (step.kind === 'tool' ? [actionLabel(step)] : []))
    ),
  ];
  if (all.some((step) => step.kind === 'if'))
    return { chip: 'AI decides', text: actions.join(' · ') || 'Ask AI' };
  if (agent?.kind === 'agent' && !actions.length)
    return { chip: 'Ask AI', text: instructionsGist(agent.instructions) };
  if (agent) return { chip: 'Ask AI', text: actions.join(' · ') };
  return { text: actions.join(' · ') || 'No steps' };
}
