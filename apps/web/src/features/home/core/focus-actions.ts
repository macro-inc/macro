import { z } from 'zod';
import SAMPLE_ACTIONS from './focus-actions.json';

const focusActionSchema = z.object({
  id: z.string(),
  importance: z.number().int().min(0).max(100),
  type: z.enum(['EMAIL_DRAFT', 'MSG_DRAFT', 'CREATE_ROUTINE', 'LINK']),
  title: z.string(),
  reason: z.string(),
  source: z.string(),
  time: z.string(),
  context: z.string(),
  draft: z.string().nullable(),
  actionLabel: z.string(),
});

export type FocusAction = z.infer<typeof focusActionSchema>;

/** Sample content only. These actions never identify or mutate real entities. */
export const FOCUS_ACTIONS = z.array(focusActionSchema).parse(SAMPLE_ACTIONS);

export const FOCUS_LABELS = {
  EMAIL_DRAFT: 'Email',
  MSG_DRAFT: 'Message',
  CREATE_ROUTINE: 'Routine',
  LINK: 'Document',
};
