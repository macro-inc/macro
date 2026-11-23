import { useSplitLayout } from '@components/app/split-layout/layout';
import { useChannelDirectory } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import { createMemo } from 'solid-js';
import { findSupportChannelId } from '../core/support-channel';

/**
 * The person's support channel with the Macro team, and how to open it.
 * Unknown until the channel directory is complete; absent when they are in
 * none.
 */
export function createSupportLink() {
  const directory = useChannelDirectory();
  const userId = useUserId();
  const { openWithSplit } = useSplitLayout();
  const channelId = createMemo(() =>
    directory.complete()
      ? findSupportChannelId(directory.channels(), userId())
      : undefined
  );

  return {
    channelId,
    open: (id: string) => {
      openWithSplit({ type: 'channel', id }, { activate: true });
    },
  };
}
