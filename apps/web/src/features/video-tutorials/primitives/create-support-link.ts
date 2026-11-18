import { useSplitLayout } from '@components/app/split-layout/layout';
import { useChannelsContext } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import { createMemo } from 'solid-js';
import { findSupportChannelId } from '../core/support-channel';

/**
 * The person's support channel with the Macro team, and how to open it.
 * Unknown while the channel list first loads; absent when they are in none.
 */
export function createSupportLink() {
  const { channels, isLoading } = useChannelsContext();
  const userId = useUserId();
  const { openWithSplit } = useSplitLayout();
  const channelId = createMemo(() =>
    isLoading() ? undefined : findSupportChannelId(channels(), userId())
  );

  return {
    channelId,
    open: (id: string) => {
      openWithSplit({ type: 'channel', id }, { activate: true });
    },
  };
}
