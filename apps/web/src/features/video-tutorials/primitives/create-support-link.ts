import { useSplitLayout } from '@components/app/split-layout/layout';
import { useChannelsContext } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import { openExternalUrl } from '@core/util/url';
import { createMemo } from 'solid-js';
import {
  findSupportChannelId,
  SUPPORT_EMAIL_URL,
} from '../core/support-channel';

/**
 * Where "Talk to us" goes: the person's support channel with the Macro team,
 * or, when they no longer have one, an email to support (which the app opens
 * in its own composer). Unknown while the channel list first loads.
 */
export function createSupportLink() {
  const { channels, isLoading } = useChannelsContext();
  const userId = useUserId();
  const { openWithSplit } = useSplitLayout();
  const channelId = createMemo(() =>
    findSupportChannelId(channels(), userId())
  );

  const open = () => {
    const id = channelId();
    if (id) {
      openWithSplit({ type: 'channel', id }, { activate: true });
      return;
    }

    openExternalUrl(SUPPORT_EMAIL_URL);
  };

  return {
    ready: () => !isLoading(),
    hasChannel: () => channelId() !== undefined,
    open,
  };
}
