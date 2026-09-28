import type { createEmailFormState } from './email-form-state';
export type EmailFormContextValue = ReturnType<typeof createEmailFormState>;

export type FormAccessKey =
  | { type: 'replying_to'; messageId: string; seed?: string }
  | { type: 'draft'; messageId: string; seed?: string };
