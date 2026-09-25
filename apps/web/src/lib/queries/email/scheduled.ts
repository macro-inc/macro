import { throwOnErr } from '@core/util/result';
import { emailClient } from '@service-email/client';
import type { Message } from '@service-email/generated/schemas';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { emailKeys } from './keys';

const SCHEDULED_PAGE_SIZE = 100;

async function fetchScheduledInbox(linkId: string): Promise<Message[]> {
  const messages: Message[] = [];
  let offset = 0;

  for (;;) {
    const page = await throwOnErr(() =>
      emailClient.getScheduledMessages(
        { offset, limit: SCHEDULED_PAGE_SIZE },
        linkId
      )
    );
    messages.push(...page.messages);
    if (page.messages.length < SCHEDULED_PAGE_SIZE) return messages;
    offset += page.messages.length;
  }
}

export async function fetchScheduledMessages(
  linkIds: string[]
): Promise<Message[]> {
  const inboxes = await Promise.all(linkIds.map(fetchScheduledInbox));
  return inboxes
    .flat()
    .filter(
      (message) =>
        message.is_draft &&
        !message.is_sent &&
        message.scheduled_send_time != null
    )
    .sort(
      (left, right) =>
        new Date(left.scheduled_send_time!).getTime() -
        new Date(right.scheduled_send_time!).getTime()
    );
}

export function useScheduledMessagesQuery(
  linkIds: Accessor<string[]>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => {
    const selectedLinkIds = [...linkIds()].sort();
    return {
      queryKey: emailKeys.scheduledMessages(selectedLinkIds).queryKey,
      enabled: enabled() && selectedLinkIds.length > 0,
      queryFn: () => fetchScheduledMessages(selectedLinkIds),
      refetchInterval: 15_000,
      refetchOnReconnect: 'always' as const,
      refetchOnWindowFocus: 'always' as const,
    };
  });
}
