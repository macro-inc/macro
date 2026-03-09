import { channelKeys } from '@queries/channel/keys';
import { queryClient } from '@queries/client';
import { createEffect, createSignal, on, type Accessor } from 'solid-js';

export function createTargetMessageControlledSignal(
  channelId: Accessor<string>,
  initialTargetMessageId: string | undefined
) {
  const [targetMessageId, setTargetMessageId] = createSignal<
    string | undefined
  >(initialTargetMessageId);

  /**
   * The paginated messages query consumes the targetMessage id as the  `load_around_message_id` query parameter
   * Once we execute the first query with this query parameter we want to clear it and reset the query correctly
   */
  createEffect(
    on(targetMessageId, (curr, prev) => {
      if (curr !== prev && curr != null) {
        queryClient.resetQueries({
          queryKey: channelKeys.messages(channelId()).queryKey,
        });
      }
    })
  );

  return [targetMessageId, setTargetMessageId];
}
