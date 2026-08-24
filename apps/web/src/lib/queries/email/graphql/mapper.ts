import type {
  AccessLevel,
  ApiContactInfo,
  ApiMessage,
  ApiMessageLabel,
  ApiThread,
} from '@service-email/generated/schemas';
import type {
  EmailThreadMessageFieldsFragment,
  EmailThreadPageFieldsFragment,
  GraphqlEntityAccessLevel,
} from '@service-storage/graphql/generated/graphql';
import { match } from 'ts-pattern';

function optional<T>(value: T | null): T | undefined {
  return value ?? undefined;
}

function mapAccessLevel(
  permission: EmailThreadPageFieldsFragment['viewerPermission']
): AccessLevel {
  if (permission?.__typename !== 'GraphqlAccessLevelPermission') {
    // An accessible email thread should always use access-level permissions.
    // Default to view-only if permission hydration fails so compose actions
    // remain disabled rather than granting more access than the viewer has.
    return 'view';
  }

  return match<GraphqlEntityAccessLevel, AccessLevel>(permission.accessLevel)
    .with('VIEW', () => 'view')
    .with('COMMENT', () => 'comment')
    .with('EDIT', () => 'edit')
    .with('OWNER', () => 'owner')
    .exhaustive();
}

function mapContact(
  contact: NonNullable<EmailThreadMessageFieldsFragment['from']>
): ApiContactInfo {
  return {
    email: contact.email,
    name: contact.name,
    photo_url: contact.photoUrl,
  };
}

function mapMessageLabel(
  message: EmailThreadMessageFieldsFragment,
  label: EmailThreadMessageFieldsFragment['labels'][number],
  labelsByProviderId: ReadonlyMap<
    string,
    EmailThreadPageFieldsFragment['labels'][number]
  >
): ApiMessageLabel {
  const canonical = labelsByProviderId.get(label.providerLabelId);
  return {
    created_at: canonical?.createdAt ?? message.createdAt,
    id: canonical?.id,
    link_id: canonical?.linkId ?? message.linkId,
    name: label.name,
    provider_label_id: label.providerLabelId,
  };
}

function mapMessage(
  message: EmailThreadMessageFieldsFragment,
  labelsByProviderId: ReadonlyMap<
    string,
    EmailThreadPageFieldsFragment['labels'][number]
  >
): ApiMessage {
  return {
    attachments: message.attachments.map((attachment) => ({
      db_id: attachment.id,
      provider_id: optional(attachment.providerId),
      filename: optional(attachment.filename),
      mime_type: optional(attachment.mimeType),
      size_bytes: optional(attachment.sizeBytes),
      sfs_id: optional(attachment.sfsId),
      content_id: optional(attachment.contentId),
    })),
    attachments_draft: message.attachmentsDraft.map((attachment) => ({
      id: attachment.id,
      draft_id: attachment.draftId,
      file_name: attachment.fileName,
      content_type: attachment.contentType,
      sha: attachment.sha,
      size: attachment.size,
      s3_key: attachment.s3Key,
    })),
    attachments_forwarded: message.attachmentsForwarded.map((attachment) => ({
      attachment_id: attachment.attachmentId,
      draft_id: attachment.draftId,
      provider_attachment_id: optional(attachment.providerAttachmentId),
      message_provider_id: attachment.messageProviderId,
      filename: optional(attachment.filename),
      mime_type: optional(attachment.mimeType),
      size_bytes: optional(attachment.sizeBytes),
    })),
    bcc: message.bcc.map(mapContact),
    body_html_sanitized: message.bodyHtmlSanitized,
    body_macro: message.bodyMacro,
    body_replyless: message.bodyReplyless,
    body_text: message.bodyText,
    cc: message.cc.map(mapContact),
    created_at: message.createdAt,
    db_id: message.id,
    from: message.from ? mapContact(message.from) : undefined,
    has_attachments: message.hasAttachments,
    internal_date_ts: message.internalDateTs,
    is_draft: message.isDraft,
    is_read: message.isRead,
    is_sent: message.isSent,
    is_starred: message.isStarred,
    labels: message.labels.map((label) =>
      mapMessageLabel(message, label, labelsByProviderId)
    ),
    link_id: message.linkId,
    provider_id: optional(message.providerId),
    replying_to_id: optional(message.replyingToId),
    scheduled_send_time: message.scheduledSendTime,
    sent_at: message.sentAt,
    snippet: message.snippet,
    subject: message.subject,
    thread_db_id: message.threadId,
    to: message.to.map(mapContact),
    updated_at: message.updatedAt,
  };
}

/** Maps one GraphQL email-thread page to the REST-compatible viewer model. */
export function mapGraphqlEmailThreadPage(
  thread: EmailThreadPageFieldsFragment
): ApiThread {
  const labelsByProviderId = new Map(
    thread.labels.map((label) => [label.providerLabelId, label])
  );

  return {
    access_level: mapAccessLevel(thread.viewerPermission),
    created_at: thread.createdAt,
    db_id: thread.id,
    inbox_visible: thread.inboxVisible,
    is_read: thread.isRead,
    latest_inbound_message_ts: thread.latestInboundMessageTs,
    link_id: thread.linkId,
    messages: thread.messages.map((message) =>
      mapMessage(message, labelsByProviderId)
    ),
    project_id: optional(thread.projectId),
    provider_id: optional(thread.providerId),
    updated_at: thread.updatedAt,
  };
}
