import { LIST_VIEW_ID } from '@app/constants/list-views';
import { withListNavigationSource } from '@app/features/soup/collection/list-navigation-source';
import { createSearchParams, useParams } from '@app/lib/split-router';
import { URL_PARAMS as CHANNEL_URL_PARAMS } from '@block-channel/constants';
import { SplitLayoutContext } from '@components/app/split-layout/context';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import {
  AppView,
  RedirectSplit,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { useViewRestoration } from '@components/app/split-layout/view-restoration';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { onMount, Show, useContext } from 'solid-js';
import { channelsSearch } from './channels-route';
import { ChannelsView } from './channels-view';
import { ChannelsViewSkeleton } from './channels-view-skeleton';

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
      {(channelId) => (
        <Show
          when={isNativeMobilePlatform()}
          fallback={<RedirectSplit to={legacyChannel(channelId())} />}
        >
          <StackChannelOverList channel={legacyChannel(channelId())} />
        </Show>
      )}
    </Show>
  );
}

/**
 * A conversation open beside the list when the app narrows (an iPhone Duo
 * folding) moves in front of the list, as if opened from it: Back and the
 * dock's Chat button then return to the list.
 */
function StackChannelOverList(props: { channel: SplitContent }) {
  const panel = useSplitPanelOrThrow();
  const layout = useContext(SplitLayoutContext);
  onMount(() => {
    const channel = withListNavigationSource(props.channel, panel.handle);
    panel.handle.replace({
      mergeHistory: true,
      next: { type: 'component', id: LIST_VIEW_ID.channels },
    });
    layout?.manager.openWithSplit(channel, {
      handle: panel.handle,
      referredFrom: LIST_VIEW_ID.channels,
      activate: true,
    });
  });
  return null;
}

export const ChannelsRouteView = withAuth(() => {
  useViewRestoration();
  const params = useParams<{ channelId?: string }>();
  const detailRequested = () => typeof params.channelId === 'string';

  return (
    <AppView
      id="channels"
      detailInlineOnly
      detailRequested={detailRequested}
      detailFallback={<ChannelsLegacyRouteView />}
    >
      <ChannelsView />
    </AppView>
  );
}, ChannelsViewSkeleton);
