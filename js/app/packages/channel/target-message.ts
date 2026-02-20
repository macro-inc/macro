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
