import type { DeliveryState, MessagingProvider } from './delivery';

export type ReplyMode = 'free_form' | 'approved_template' | 'human_support';
export type MediaKind = 'image' | 'audio' | 'video' | 'document';
export type ReplyBlockReason =
  | 'forbidden'
  | 'disconnected'
  | 'window_closed'
  | 'template_required'
  | 'human_support_required'
  | 'unsupported'
  | 'group_read_only';

export type MediaCapability = {
  kind: MediaKind;
  mime_types: string[];
  max_bytes: number;
  caption_limit?: number | null;
};
export type ReplyCapabilities = {
  modes: ReplyMode[];
  text_limit: number;
  text_limit_in_bytes: boolean;
  media: MediaCapability[];
  max_attachments: number;
};
export type ModeEligibility = {
  mode: ReplyMode;
  allowed: boolean;
  reason?: ReplyBlockReason | null;
  expires_at?: string | null;
};
export type ReplyEligibility = {
  evaluated_at: string;
  modes: ModeEligibility[];
};
export type ConversationAccount = {
  transport?: 'linked';
  authorization_generation?: number;
  provider: MessagingProvider;
  account_name: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'revoked' | 'error';
  health_error?: string | null;
  can_reply: boolean;
  capabilities: ReplyCapabilities;
  eligibility: ReplyEligibility;
  conversation: {
    channel_id: string;
    connection_id: string;
    customer_id: string;
    customer_display_name?: string | null;
    customer_handle?: string | null;
    customer_phone?: string | null;
  };
};

/** Unknown bindings fail closed; known internal channels retain native behavior. */
export type ChannelInteraction =
  | { kind: 'internal' }
  | { kind: 'external'; account: ConversationAccount; available: boolean }
  | { kind: 'group_setup' }
  | { kind: 'loading' }
  | { kind: 'error' };

/** Compatibility shape for the existing durable request; drafts keep their v1 format. */
export type ReplyRequest = {
  idempotency_key: string;
  human_support?: boolean;
  reply_to?: string | null;
  message:
    | { type: 'text'; text: string }
    | {
        type: 'mutation';
        message_id: string;
        operation: 'reaction' | 'edit' | 'delete';
        text?: string | null;
      }
    | {
        type: 'media';
        document_id: string;
        kind: MediaKind;
        caption?: string | null;
      }
    | {
        type: 'template';
        template_id: string;
        language: string;
        parameters: string[];
      };
};
export type ReplyAttempt = {
  id: string;
  channel_id: string;
  user_id: string;
  created_at: string;
  state: DeliveryState;
  message_id?: string | null;
  error_code?: string | null;
  payload: ReplyRequest;
};
export type ReplyAttachment = {
  document_id: string;
  filename: string;
  kind: MediaKind;
};
export type ReplyTemplate = {
  id: string;
  name: string;
  language: string;
  preview: string;
  parameter_labels: string[];
  unsupported_reason?: string | null;
};

/** Local expiry may remove permission, but cannot turn a server denial into an allow. */
export function modeAllowed(
  eligibility: ReplyEligibility,
  mode: ReplyMode,
  now: number
): boolean {
  const decision = eligibility.modes.find((entry) => entry.mode === mode);
  return (
    Number.isFinite(now) &&
    decision?.allowed === true &&
    (!decision.expires_at || Date.parse(decision.expires_at) > now)
  );
}
