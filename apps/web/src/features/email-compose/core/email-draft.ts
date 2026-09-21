import type { EmailContact } from '../../email-message/core/email-message';

/** Feature-owned values. Transport adaptation belongs to queries. */
export interface EmailDraft {
  bcc?: EmailContact[] | null;
  body_html?: string | null;
  body_macro?: string | null;
  body_text?: string | null;
  cc?: EmailContact[] | null;
  db_id?: string | null;
  include_signature?: boolean | null;
  provider_id?: string | null;
  provider_thread_id?: string | null;
  replying_to_id?: string | null;
  subject: string;
  thread_db_id?: string | null;
  to?: EmailContact[] | null;
}
