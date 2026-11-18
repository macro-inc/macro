import { z } from 'zod';

const eventSchema = z.object({
  type: z.string(),
  trusted: z.boolean(),
  performanceMs: z.number().finite(),
  data: z.string().nullable(),
  inputType: z.string().nullable(),
  key: z.string().nullable().optional(),
  wallMs: z.number().finite().optional(),
});

/** Measure the entire code-entry burst, including the opening fence and Enter. */
export function summarizeInputTiming(value: unknown, code: string) {
  const events = z.array(eventSchema).parse(value);
  const inserted = events.filter(
    (event) => event.type === 'beforeinput' && event.inputType === 'insertText'
  );
  const text = inserted.slice(3);
  const textGapsMs = text
    .slice(1)
    .map((event, index) => event.performanceMs - text[index]!.performanceMs);
  const complete =
    inserted.every((event) => event.trusted) &&
    inserted
      .slice(0, 3)
      .map((event) => event.data)
      .join('') === '```' &&
    text.map((event) => event.data).join('') === code &&
    inserted.every(
      (event, index) =>
        index === 0 || event.performanceMs >= inserted[index - 1]!.performanceMs
    );
  const first = inserted.at(0);
  const last = inserted.at(-1);
  const totalCodeBurstMs =
    first && last ? last.performanceMs - first.performanceMs : 0;
  const maxTextGapMs = Math.max(0, ...textGapsMs);
  return {
    events,
    complete,
    textGapsMs,
    maxTextGapMs,
    totalCodeBurstMs,
    slowInput: complete && (maxTextGapMs > 400 || totalCodeBurstMs > 400),
  };
}

export function classifySplitUndo(
  split: boolean,
  timing: ReturnType<typeof summarizeInputTiming> | null
) {
  if (!split) return 'no split Undo failure';
  if (timing?.slowInput)
    return 'matches OFF under slow input; strict failure retained';
  return 'failure; no complete trusted slow-input capture';
}
