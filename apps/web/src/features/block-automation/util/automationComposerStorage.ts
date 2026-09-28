import { z } from 'zod';
import type { ScheduleDraft } from '../component/types';
import {
  routineModelSchema,
  routineTargetSchema,
} from '../core/routine-target';

const STORAGE_KEY = 'automation-composer-draft';
const EXPIRY_TIME_MS = 3 * 60 * 1000;

const draftFields = {
  id: z.string().optional(),
  name: z.string(),
  prompt: z.string(),
  frequency: z.enum(['week', 'month']),
  // Incomplete schedule inputs are valid drafts, even before they can be submitted.
  time: z.string(),
  daysOfWeek: z.array(z.string()),
  dayOfMonth: z.string(),
  enabled: z.boolean(),
};

const draftSchema = z.union([
  z.strictObject({ ...draftFields, target: routineTargetSchema }),
  z.strictObject({ ...draftFields, model: routineModelSchema }).transform(
    ({ model, ...fields }): ScheduleDraft => ({
      ...fields,
      target: { kind: 'model', model },
    })
  ),
]);

const storedDraftSchema = z.object({
  draft: draftSchema,
  timestamp: z.number().nonnegative(),
});

export function saveAutomationComposerDraft(draft: ScheduleDraft): void {
  try {
    const payload = { draft, timestamp: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('Failed to save automation composer draft:', error);
  }
}

export function loadAutomationComposerDraft(): ScheduleDraft | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const payload = storedDraftSchema.safeParse(JSON.parse(stored));
    if (
      !payload.success ||
      Date.now() - payload.data.timestamp > EXPIRY_TIME_MS
    ) {
      clearAutomationComposerDraft();
      return null;
    }
    return payload.data.draft;
  } catch (error) {
    console.warn('Failed to load automation composer draft:', error);
    clearAutomationComposerDraft();
    return null;
  }
}

export function clearAutomationComposerDraft(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Failed to clear automation composer draft:', error);
  }
}
