import { buildFlatSoupRows } from '@app/features/soup';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useUserId } from '@core/context/user';
import type { EmailEntity } from '@entity';
import { useEmailLinksQuery } from '@queries/email/link';
import { useScheduledMessagesQuery } from '@queries/email/scheduled';
import type { Message } from '@service-email/generated/schemas';
import { createMemo } from 'solid-js';
import type {
  EmailDataSource,
  EmailDataSourceInput,
  EmailDataSourceItem,
} from './use-email-query';

/** A scheduled draft as its thread's list row, addressed like other drafts. */
export function scheduledEmailEntity(
  message: Message,
  ownerId: string
): EmailEntity {
  return {
    type: 'email',
    id: message.thread_db_id,
    name: message.subject ?? '',
    ownerId,
    isRead: true,
    isDraft: true,
    isImportant: false,
    done: false,
    snippet: message.snippet ?? undefined,
    linkId: message.link_id,
    participants: message.to.map((recipient) => ({
      email: recipient.email,
      name: recipient.name ?? undefined,
    })),
    scheduledSendTime: message.scheduled_send_time ?? undefined,
    createdAt: message.created_at,
    updatedAt: message.updated_at,
  };
}

/**
 * Scheduled mail for the selected inboxes, soonest first. The scheduled
 * endpoint is authoritative here: soup rows carry no schedule, and a draft
 * with only a local send time is not scheduled.
 */
export function useScheduledEmailSource(
  state: EmailDataSourceInput
): EmailDataSource {
  const notificationSource = useGlobalNotificationSource();
  const userId = useUserId();
  const links = useEmailLinksQuery();
  const linkIds = createMemo(() => {
    if (!links.isSuccess) return [];
    const available = links.data.links.map((link) => link.id);
    if (state.inboxIds === undefined) return available;
    const selected = new Set(state.inboxIds);
    return available.filter((id) => selected.has(id));
  });
  const scheduled = useScheduledMessagesQuery(
    linkIds,
    () => state.tab === 'scheduled' && links.isSuccess
  );

  const items = createMemo((): EmailDataSourceItem[] => {
    if (!scheduled.isSuccess) return [];
    // One row per thread, like every other email list; the soonest send wins.
    const threadIds = new Set<string>();
    const entities = [];
    for (const message of scheduled.data) {
      if (threadIds.has(message.thread_db_id)) continue;
      threadIds.add(message.thread_db_id);
      entities.push(
        withEntityNotifications(
          scheduledEmailEntity(message, userId() ?? ''),
          notificationSource
        )
      );
    }
    return buildFlatSoupRows(entities);
  });

  return {
    items,
    isLoading: () =>
      links.isLoading || (linkIds().length > 0 && scheduled.isLoading),
    isFetching: () => scheduled.isFetching,
    error: () => links.error ?? scheduled.error ?? undefined,
    hasMore: () => false,
    isLoadingMore: () => false,
    loadMore: async () => {},
    refresh: async () => {
      // The scheduled query waits on the inbox list, so a failed list is the
      // thing to retry; the scheduled read follows once it succeeds.
      if (links.isError) {
        await links.refetch();
        return;
      }
      await scheduled.refetch();
    },
  };
}
