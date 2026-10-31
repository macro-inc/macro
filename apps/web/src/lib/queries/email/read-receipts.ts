import { throwOnErr } from '@core/util/result';
import { emailClient } from '@service-email/client';
import type {
  MessageReadReceipt,
  ThreadReadReceipts,
} from '@service-email/generated/schemas';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { emailKeys } from './keys';

/** The viewer's tracked sent messages in one thread, keyed by message id. */
export type ReadReceiptsByMessage = Record<string, MessageReadReceipt>;

const REFRESH_INTERVAL = 60_000;

function byMessage({ receipts }: ThreadReadReceipts): ReadReceiptsByMessage {
  return Object.fromEntries(receipts.map((r) => [r.message_id, r]));
}

function threadReadReceiptsQueryOptions(threadId: string, enabled: boolean) {
  return {
    queryKey: emailKeys.threadReadReceipts(threadId).queryKey,
    queryFn: () =>
      throwOnErr(() => emailClient.getThreadReadReceipts(threadId)),
    select: byMessage,
    enabled,
    staleTime: REFRESH_INTERVAL,
    refetchInterval: REFRESH_INTERVAL,
    refetchOnWindowFocus: true,
  };
}

/** Polls while the thread is open; recipients' opens arrive asynchronously. */
export function useThreadReadReceiptsQuery(
  threadId: Accessor<string>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => threadReadReceiptsQueryOptions(threadId(), enabled()));
}
