import { createSearchParams, useParams } from '@app/lib/split-router';
import { URL_PARAMS as CHANNEL_URL_PARAMS } from '@block-channel/constants';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import {
  AppView,
  RedirectSplit,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { Show } from 'solid-js';
import { channelsSearch } from './channels-route';
import { ChannelsView } from './channels-view';

function ChannelsLegacyRouteView() {
  const params = useParams<{ channelId?: string }>();
  const [search] = createSearchParams(channelsSearch);
  const legacyChannel = (id: string): SplitContent => {
    const params: Record<string, string> = {};
    if (search.messageId) params[CHANNEL_URL_PARAMS.message] = search.messageId;
    if (search.threadId) params[CHANNEL_URL_PARAMS.thread] = search.threadId;
    return { type: 'channel', id, params };
  };

  return (
    <Show when={params.channelId}>
      {(channelId) => <RedirectSplit to={legacyChannel(channelId())} />}
    </Show>
  );
}

export const ChannelsRouteView = withAuth(() => {
  const params = useParams<{ channelId?: string }>();
  const detailRequested = () => typeof params.channelId === 'string';

  return (
    <AppView
      id="channels"
      detailDesktopOnly
      detailRequested={detailRequested}
      detailFallback={<ChannelsLegacyRouteView />}
    >
      <ChannelsView />
    </AppView>
  );
});
