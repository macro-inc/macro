import { z } from 'zod';

const weekday = z.enum(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']);
export const recurrenceConfigSchema = z.object({
  frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']),
  interval: z.number().int().positive(),
  byDay: z.array(weekday),
  monthlyByDay: z
    .object({
      ordinal: z.union([z.literal(-1), z.number().int().min(1).max(5)]),
      weekday,
    })
    .optional(),
  ends: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('never') }),
    z.object({ kind: z.literal('after'), count: z.number().int().positive() }),
    z.object({ kind: z.literal('on'), date: z.iso.date() }),
  ]),
});

/** Invalid model/manual data remains unresolved instead of turning into a one-off event. */
export function parseRecurrenceDraft(value: string) {
  try {
    return recurrenceConfigSchema.parse(JSON.parse(value));
  } catch {
    return undefined;
  }
}
