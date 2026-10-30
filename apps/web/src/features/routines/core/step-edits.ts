import { match } from 'ts-pattern';
import {
  flattenSteps,
  ifStep,
  newStepId,
  type StepDraft,
} from './routine-steps';

/**
 * A copy of `step` with new ids. Its outputs take names no step in `steps`
 * uses, and its own references to them follow.
 */
export function copyStep(step: StepDraft, steps: StepDraft[]): StepDraft {
  const taken = new Set(
    flattenSteps(steps).flatMap((item) =>
      item.kind === 'tool' && item.output ? [item.output] : []
    )
  );
  const renames = new Map<string, string>();
  for (const item of flattenSteps([step])) {
    if (item.kind !== 'tool' || !item.output) continue;
    let name = item.output;
    for (let index = 2; taken.has(name); index += 1)
      name = `${item.output}_${index}`;
    taken.add(name);
    renames.set(item.output, name);
  }
  const follow = (args: Record<string, unknown>): Record<string, unknown> =>
    JSON.parse(
      JSON.stringify(args).replace(
        /\{\{steps\.([A-Za-z0-9_]+)\./g,
        (found, name: string) => {
          const renamed = renames.get(name);
          return renamed ? `{{steps.${renamed}.` : found;
        }
      )
    );
  const copy = (item: StepDraft): StepDraft =>
    match(item)
      .returnType<StepDraft>()
      .with({ kind: 'agent' }, (item) => ({ ...item, id: newStepId() }))
      .with({ kind: 'tool' }, (item) => ({
        ...item,
        id: newStepId(),
        arguments: follow(item.arguments),
        ...(item.output ? { output: renames.get(item.output) } : {}),
      }))
      .with({ kind: 'if' }, (item) => ({
        ...item,
        id: newStepId(),
        yes: item.yes.map(copy),
        no: item.no.map(copy),
      }))
      .with({ kind: 'choose' }, (item) => ({
        ...item,
        id: newStepId(),
        options: item.options.map((option) => ({
          ...option,
          id: newStepId(),
          steps: option.steps.map(copy),
        })),
        otherwise: item.otherwise.map(copy),
      }))
      .exhaustive();
  return copy(step);
}

/** `step` as the Yes branch of a new, unasked yes/no question. */
export function wrapInIf(step: StepDraft): StepDraft {
  return { ...ifStep(), yes: [step] };
}
