import { z } from 'zod';
import type { ScheduleDraft } from './core/draft';
import { routineModelSchema, routineTargetSchema } from './core/routine-target';
import { routineTriggerSchema } from './core/routine-triggers';

const STORAGE_KEY = 'routine-composer-draft';
const EXPIRY_TIME_MS = 3 * 60 * 1000;

const draftFields = {
  id: z.string().optional(),
  triggers: z.array(routineTriggerSchema).max(16).optional(),
  name: z.string(),
  prompt: z.string(),
  frequency: z.enum(['week', 'month', 'once']),
  // Incomplete schedule inputs are valid drafts, even before they can be submitted.
  time: z.string(),
  onceAt: z.string().optional(),
  timezone: z.string().optional(),
  daysOfWeek: z.array(z.string()),
  dayOfMonth: z.string(),
  // Older clients saved routine activation with the draft.
  enabled: z.boolean().optional(),
};

const draftSchema = z
  .union([
    z.strictObject({ ...draftFields, target: routineTargetSchema }),
    z
      .strictObject({ ...draftFields, model: routineModelSchema })
      .transform(({ model, ...fields }) => ({
        ...fields,
        target: { kind: 'model' as const, model },
      })),
  ])
  .transform((draft): ScheduleDraft => draft);

const storedDraftSchema = z.object({
  draft: draftSchema,
  timestamp: z.number().nonnegative(),
});

export function saveRoutineComposerDraft(draft: ScheduleDraft): void {
  try {
    const payload = { draft, timestamp: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('Failed to save routine composer draft:', error);
  }
}

export function loadRoutineComposerDraft(): ScheduleDraft | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const payload = storedDraftSchema.safeParse(JSON.parse(stored));
    if (
      !payload.success ||
      Date.now() - payload.data.timestamp > EXPIRY_TIME_MS
    ) {
      clearRoutineComposerDraft();
      return null;
    }
    return payload.data.draft;
  } catch (error) {
    console.warn('Failed to load routine composer draft:', error);
    clearRoutineComposerDraft();
    return null;
  }
}

export function clearRoutineComposerDraft(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Failed to clear routine composer draft:', error);
  }
}
