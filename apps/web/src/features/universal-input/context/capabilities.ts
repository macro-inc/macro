import type {
  Draft,
  InputFields,
  Intent,
  Scores,
  Submission,
  SubmissionResult,
  Suggestions,
} from '../core/input';
import type { Recipient } from '../core/recipients';

/** Read-only options displayed around the editor, supplied by the application host. */
export interface InputDisplay {
  people(): Recipient[];
  destinations(): Recipient[];
  recipients(
    fields: InputFields,
    message?: boolean
  ): { recipients: Recipient[]; unresolved: string[] };
  calendars(): { id: string; name: string; emailAddress: string }[];
  selectedCalendar(fields: InputFields): { id: string } | undefined;
  inboxes(): { id: string; email_address: string }[];
  selectedInbox(fields: InputFields): { id: string } | undefined;
  roster(): { id: string; name: string; unavailableReason?: string }[];
  agentsEnabled(): boolean;
  models(): { id: string; label: string }[];
  model(): string;
  attachmentCount(): number;
  clearAttachments(): void;
}

export interface InputCapabilities {
  classify(
    text: string,
    revision: number
  ): Promise<{ revision: number; scores: Scores }>;
  extract(
    text: string,
    intent: Intent,
    revision: number
  ): Promise<{ revision: number; intent: Intent; suggestions: Suggestions }>;
  submit(input: Submission): Promise<SubmissionResult>;
  validate(input: Submission): string | undefined;
  readDraft(): Draft | undefined;
  saveDraft(draft: Draft): void;
}
