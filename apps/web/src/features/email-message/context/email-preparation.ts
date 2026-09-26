import type {
  BodyOptions,
  EmailBodyInput,
  PreparedEmailBody,
} from '@macro-inc/email-renderer';

export interface EmailPreparationRequest {
  messageId: string;
  threadId: string;
  mailboxId: string;
  input: EmailBodyInput;
  options: BodyOptions;
  /** Zero is foreground; larger numbers are speculative priorities. */
  priority?: number;
}

export interface PreparedEmailLease {
  readonly ready: PreparedEmailBody | undefined;
  readonly promise: Promise<PreparedEmailBody>;
  promote(): void;
  release(): void;
}

/** Source authorization stays with the caller; artifacts never grant access. */
export interface EmailPreparation {
  acquire(request: EmailPreparationRequest): PreparedEmailLease;
}
