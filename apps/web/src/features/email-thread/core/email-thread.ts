import type { EmailMessage } from '../../email-message/core/email-message';

/** Feature-owned values. Transport adaptation belongs to queries. */
export interface EmailThread {
  access_level: 'view' | 'comment' | 'edit' | 'owner';
  db_id: string;
  inbox_visible: boolean;
  is_read: boolean;
  latest_inbound_message_ts?: string | null;
  link_id: string;
  messages: EmailMessage[];
  project_id?: string | null;
  provider_id?: string | null;
}
