import type { UnifiedNotification } from '@notifications/types';
import { type Accessor, createMemo } from 'solid-js';
import {
  type ChannelStack,
  channelStacks,
  keepUnchangedStacks,
  stacksByThread,
} from '../core/channel-stacks';

/**
 * A channel's notification stacks, from its notification sources with local
 * seen and done marks applied, so a stack leaves as soon as it is marked.
 */
export function createChannelNotificationStacks(sources: {
  /** Not-done notifications; undefined until they load. */
  active: Accessor<readonly UnifiedNotification[] | undefined>;
  /** Unread notifications, which the channel loads anyway. */
  unread: Accessor<readonly UnifiedNotification[]>;
}) {
  const notDone = createMemo<ChannelStack[]>(
    (previous) =>
      keepUnchangedStacks(
        previous,
        channelStacks(
          (sources.active() ?? []).filter(
            (notification) => notification.state !== 'done'
          )
        )
      ),
    []
  );
  const unread = createMemo<ChannelStack[]>(
    (previous) =>
      keepUnchangedStacks(
        previous,
        channelStacks(
          sources
            .unread()
            .filter((notification) => notification.state === 'unseen')
        )
      ),
    []
  );
  const notDoneByThread = createMemo(() => stacksByThread(notDone()));

  return { notDone, unread, notDoneByThread };
}
