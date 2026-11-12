import { useThreadQuery } from '@queries/email/thread';
import type { ApiThread } from '@service-email/generated/schemas';
import type { InfiniteData } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { type ThreadFacts, threadFacts } from '../core/thread';

function selectFacts(draftId: string | undefined) {
  return (data: InfiniteData<ApiThread, number>): ThreadFacts =>
    threadFacts(
      data.pages.flatMap((page) =>
        page.messages.map((message) => ({
          id: message.db_id,
          isDraft: message.is_draft,
          isSent: message.is_sent,
          at: message.internal_date_ts ?? message.sent_at ?? message.created_at,
          // A bare address in front of the subject reads worse than none.
          from: message.from?.name ?? undefined,
          text: message.body_text ?? message.snippet ?? undefined,
        }))
      ),
      draftId
    );
}

/** What a reply suggestion's card shows of its email thread; undefined until read. */
export function useSuggestionThread(
  threadId: Accessor<string>,
  draftId?: Accessor<string | undefined>
): Accessor<ThreadFacts | undefined> {
  const thread = useThreadQuery(threadId, () => ({
    select: selectFacts(draftId?.()),
  }));

  return () => (thread.isSuccess ? thread.data : undefined);
}
