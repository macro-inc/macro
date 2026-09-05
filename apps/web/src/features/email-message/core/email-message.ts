/** Feature-owned values. Transport adaptation belongs to queries. */
export interface EmailContact {
  email: string;
  name?: string | null;
  photo_url?: string | null;
}

export interface EmailAttachment {
  content_id?: string | null;
  data_url?: string | null;
  db_id: string;
  filename?: string | null;
  mime_type?: string | null;
  provider_id?: string | null;
  sfs_id?: string | null;
  size_bytes?: number | null;
}

export interface EmailDraftAttachment {
  content_type: string;
  draft_id: string;
  file_name: string;
  id: string;
  s3_key: string;
  sha: string;
  size: number;
}

export interface EmailForwardedAttachment {
  attachment_id: string;
  draft_id: string;
  filename?: string | null;
  message_provider_id: string;
  mime_type?: string | null;
  provider_attachment_id?: string | null;
  size_bytes?: number | null;
}

export interface EmailLabel {
  created_at: string;
  id?: string | null;
  label_list_visibility?:
    | null
    | ('LabelShow' | 'LabelShowIfUnread' | 'LabelHide');
  link_id: string;
  message_list_visibility?: null | ('Show' | 'Hide');
  name?: string | null;
  provider_label_id: string;
  type_?: null | ('System' | 'User');
}

export interface EmailMessage {
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
  global_id?: string | null;
  has_attachments: boolean;
  headers_json?: unknown;
  internal_date_ts?: string | null;
  is_draft: boolean;
  is_read: boolean;
  is_sent: boolean;
  is_starred: boolean;
  labels: EmailLabel[];
  link_id: string;
  provider_history_id?: string | null;
  provider_id?: string | null;
  provider_thread_id?: string | null;
  replying_to_id?: string | null;
  scheduled_send_time?: string | null;
  sent_at?: string | null;
  size_estimate?: number | null;
  snippet?: string | null;
  subject?: string | null;
  thread_db_id: string;
  to: EmailContact[];
  updated_at: string;
}
