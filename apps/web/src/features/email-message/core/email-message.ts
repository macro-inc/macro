import type { CalendarInvitation } from './calendar-invitation';
import type { MessageOperation } from './message-operation';
/** Feature-owned values. Transport adaptation belongs to queries. */
export interface EmailContact {
  email: string;
  name?: string | null;
  photo_url?: string | null;
}

export interface EmailAttachment {
  reference_url?: string | null;
  content_id?: string | null;
  db_id: string;
  filename?: string | null;
  mime_type?: string | null;
  sfs_id?: string | null;
  size_bytes?: number | null;
}

export interface EmailDraftAttachment {
  upload_pending?: boolean;
  content_id?: string | null;
  is_inline?: boolean;
  content_type: string;
  file_name: string;
  id: string;
  s3_key: string;
  size: number;
}

export interface EmailForwardedAttachment {
  attachment_id: string;
  filename?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
}

export interface EmailLabel {
  name?: string | null;
  provider_label_id: string;
}

export interface EmailMessage {
  operation?: MessageOperation | null;
  calendar_invitations?: CalendarInvitation[];
  attachments: EmailAttachment[];
  attachments_draft: EmailDraftAttachment[];
  attachments_forwarded: EmailForwardedAttachment[];
  bcc: EmailContact[];
  body_html_sanitized?: string | null;
  body_macro?: string | null;
  body_replyless?: string | null;
  body_text?: string | null;
  cc: EmailContact[];
  created_at: string;
  db_id: string;
  from?: null | EmailContact;
  internal_date_ts?: string | null;
  is_draft: boolean;
  is_read: boolean;
  labels: EmailLabel[];
  link_id: string;
  provider_id?: string | null;
  replying_to_id?: string | null;
  scheduled_send_time?: string | null;
  sent_at?: string | null;
  snippet?: string | null;
  subject?: string | null;
  thread_db_id: string;
  to: EmailContact[];
  updated_at: string;
}
