import type { ThreadQueryData, ThreadQueryResult } from '@queries/email/thread';
import type { ApiThread } from '@service-email/generated/schemas';
import { type Accessor, createMemo } from 'solid-js';
import type { EmailThreadSource } from '../context/email-thread-context';
import type { EmailThread } from '../core/email-thread';

/** Project transport data onto feature-owned values; this is not runtime validation. */
export function toEmailThread(thread: ApiThread): EmailThread {
  return {
    access_level: thread.access_level,
    db_id: thread.db_id,
    inbox_visible: thread.inbox_visible,
    is_read: thread.is_read,
    latest_inbound_message_ts: thread.latest_inbound_message_ts,
    link_id: thread.link_id,
    messages: thread.messages.map((message) => ({
      attachments: message.attachments.map((attachment) => ({
        content_id: attachment.content_id,
        db_id: attachment.db_id,
        filename: attachment.filename,
        mime_type: attachment.mime_type,
        sfs_id: attachment.sfs_id,
        size_bytes: attachment.size_bytes,
      })),
      attachments_draft: message.attachments_draft.map((attachment) => ({
        content_type: attachment.content_type,
        file_name: attachment.file_name,
        id: attachment.id,
        s3_key: attachment.s3_key,
        size: attachment.size,
      })),
      attachments_forwarded: message.attachments_forwarded.map(
        (attachment) => ({
          attachment_id: attachment.attachment_id,
          filename: attachment.filename,
          mime_type: attachment.mime_type,
          size_bytes: attachment.size_bytes,
        })
      ),
      bcc: message.bcc.map((contact) => ({
        email: contact.email,
        name: contact.name,
        photo_url: contact.photo_url,
      })),
      body_html_sanitized: message.body_html_sanitized,
      body_macro: message.body_macro,
      body_replyless: message.body_replyless,
      body_text: message.body_text,
      cc: message.cc.map((contact) => ({
        email: contact.email,
        name: contact.name,
        photo_url: contact.photo_url,
      })),
      created_at: message.created_at,
      db_id: message.db_id,
      from: message.from
        ? {
            email: message.from.email,
            name: message.from.name,
            photo_url: message.from.photo_url,
          }
        : message.from,
      internal_date_ts: message.internal_date_ts,
      is_draft: message.is_draft,
      labels: message.labels.map((label) => ({
        name: label.name,
        provider_label_id: label.provider_label_id,
      })),
      link_id: message.link_id,
      provider_id: message.provider_id,
      replying_to_id: message.replying_to_id,
      scheduled_send_time: message.scheduled_send_time,
      sent_at: message.sent_at,
      snippet: message.snippet,
      subject: message.subject,
      thread_db_id: message.thread_db_id,
      to: message.to.map((contact) => ({
        email: contact.email,
        name: contact.name,
        photo_url: contact.photo_url,
      })),
      updated_at: message.updated_at,
    })),
    project_id: thread.project_id,
    provider_id: thread.provider_id,
  };
}

export function createEmailThreadSource(
  threadId: Accessor<string>,
  query: ThreadQueryResult<ThreadQueryData>
): EmailThreadSource {
  // Status guards prevent a pending Solid resource from suspending its owner.
  const thread = createMemo(() => {
    if (!query.isSuccess && !query.isError) return undefined;
    const data = query.data?.thread;
    return data?.db_id === threadId() ? toEmailThread(data) : undefined;
  });
  return {
    id: threadId,
    thread,
    isError: () => query.isError,
    isLoading: () => query.isLoading,
    isFetching: () => query.isFetching,
    isFetchingOlder: () => query.isFetchingNextPage,
    hasMore: () => query.hasNextPage,
    fetchOlder: async () => {
      await query.fetchNextPage();
    },
    refresh: async () => {
      await query.refetch();
    },
  };
}
