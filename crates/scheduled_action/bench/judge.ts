// The blind model judge: a second opinion on each draft, from a model that
// sees only the request and the routine, never the arm, build or the
// mechanical checks. Its score is reported apart from the mechanical score;
// `drafts.ts calibrate` measures how often it agrees with grades given by hand.

import type { Case, DraftResult } from './cases';
import { type Stack, call } from './stack';
import { lookalikes } from './workspace';

export const JUDGE_MODEL = 'anthropic/claude-opus-5-5';

export const RUBRIC = `You review an automation ("routine") that was drafted from what a person typed in their work app. Grade it on a 1 to 5 scale:

5: does exactly what was asked, on the right items, at the right time. Nothing a careful person would change.
4: right, with only a cosmetic issue (its name, the wording of a message it posts).
3: would work, but the person would have to fix something: a detail missing or extra, a looser filter than asked, more noise than asked.
2: does something other than what was asked, or on the wrong item (a channel, person, project or document with a similar name).
1: would not work, or does nothing like the request.

Check, in order:
- When it runs: the trigger matches the request (the schedule's days and time, or the event).
- What it acts on: the items it uses are the ones the person named, by their exact name, not a look-alike. The glossary says which item each id is.
- What it does: the steps do what was asked and only that.
- A request naming something with no match, or with two matches, is best answered by leaving that item for the person to pick or by asking which one; guessing is a 2.
- If the agent asked a question instead of drafting, grade whether asking was right.

Give the score and at most three problems, each one short sentence. Say nothing about formatting.`;

const SCHEMA = {
  name: 'routine_review',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['score', 'problems'],
    properties: {
      score: { type: 'integer', minimum: 1, maximum: 5 },
      problems: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    },
  },
};

export type Grade = { score: number; problems: string[] };

/** A grade of 4 or 5: a draft the person would keep as it is. */
export const passes = (grade: Grade) => grade.score >= 4;

/** Ids in the draft, with the workspace item each one is. */
function glossary(draft: DraftResult, names: Map<string, string>): string[] {
  const body = JSON.stringify([draft.trigger, draft.steps, draft.step, draft.task]);
  const found = new Set(body.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []);
  return [...found].map((id) => `${id}: ${names.get(id) ?? 'not one of the person’s items'}`);
}

/** The routine a step case starts from. */
export type BaseShape = { name: string; trigger: unknown; steps: unknown[] };

/**
 * What the judge reads: the request, the person's items with names like the
 * ones in it, the routine (and for a step case the routine it changes), with
 * nothing that says which arm or build made it.
 */
export function judgePrompt(
  item: Case,
  draft: DraftResult,
  reply: string | undefined,
  names: Map<string, string>,
  base?: BaseShape,
) {
  const lines = [`The person typed: "${item.text}"`];
  // Complete lists: every person, channel, project, document and database
  // whose name shares a word with the request (tasks aren't listed).
  const { people, items } = lookalikes(item.text);
  lines.push('', `People in the person's workspace with a name in the request: ${people.join('; ') || 'none'}.`);
  lines.push(
    `Channels, projects, documents and databases with a word of the request in their name: ${items.join('; ') || 'none'}.`,
  );
  if (base) {
    const verb = item.kind === 'add_step' ? 'add a step to' : `change step ${(item.index ?? 0) + 1} of`;
    lines.push('', `It was a request to ${verb} this existing routine:`, JSON.stringify(base, null, 1));
  }
  if (draft.outcome === 'failed') {
    lines.push('', 'No routine was made. The agent answered:', reply || draft.message || '(nothing)');
  } else if (draft.outcome === 'step') {
    const what = item.kind === 'add_step' ? 'The steps added after the existing ones' : 'The changed step';
    lines.push('', `${what}:`, JSON.stringify(draft.step, null, 1));
  } else {
    const shown = { name: draft.name, trigger: draft.trigger, steps: draft.steps, task: draft.task };
    lines.push('', 'The routine:', JSON.stringify(shown, null, 1));
  }
  const ids = draft.outcome === 'failed' ? [] : glossary(draft, names);
  if (ids.length) lines.push('', 'Glossary of ids in it:', ...ids);
  return lines.join('\n');
}

export async function judge(
  at: Stack,
  token: string,
  item: Case,
  draft: DraftResult,
  reply: string | undefined,
  names: Map<string, string>,
  base?: BaseShape,
): Promise<Grade | { error: string }> {
  try {
    const response = await call<{ outcome: { status: string; result?: Grade; reason?: string } }>(
      `${at.harness}/cognition/structured-completion`,
      {
        method: 'POST',
        token,
        body: JSON.stringify({
          prompt: judgePrompt(item, draft, reply, names, base),
          model: JUDGE_MODEL,
          output_schema: SCHEMA,
          additional_instructions: RUBRIC,
          toolset: { type: 'none' },
        }),
      },
    );
    if (response.outcome.status !== 'completed' || !response.outcome.result) {
      return { error: response.outcome.reason ?? response.outcome.status };
    }
    return response.outcome.result;
  } catch (error) {
    return { error: String(error).slice(0, 300) };
  }
}
