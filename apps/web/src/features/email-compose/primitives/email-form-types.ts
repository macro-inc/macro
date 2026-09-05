import type { createEmailFormState } from './email-form-state';
export type EmailFormContextValue = ReturnType<typeof createEmailFormState>;

export type FormAccessKey =
  | { type: 'replying_to'; messageID: string; seed?: string }
  | { type: 'draft'; messageID: string; seed?: string };
