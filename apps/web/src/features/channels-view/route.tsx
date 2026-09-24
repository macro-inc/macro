import {
  createSearchParams,
  defineRoute,
  useParams,
} from '@app/lib/split-router';
import { URL_PARAMS as CHANNEL_URL_PARAMS } from '@block-channel/constants';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import {
  NewAppView,
  RedirectSplit,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { lazy, Show } from 'solid-js';
import { z } from 'zod';
import { getViewPreset } from '../next-soup/sidebar/soup-filter-presets';
import { channelDetailSearch } from './channels-route';

const SoupView = lazy(async () => ({
  default: (await import('../next-soup/soup-view/soup-view')).SoupView,
}));
const ChannelsView = lazy(async () => ({
  default: (await import('./channels-view')).ChannelsView,
}));
const ChannelDetailRouteView = lazy(async () => ({
  default: (await import('./channels-view')).ChannelDetailRouteView,
}));

function LegacyChannelsView() {
  const preset = getViewPreset('channels');
  return (
    <SoupView
      viewName="Channels"
      initialFilters={preset?.filters}
      initialClientFilters={preset?.clientFilters}
      initialGroupBy={preset?.groupBy}
    />
  );
}

function ChannelsLegacyRouteView() {
  const params = useParams<{ channelId?: string }>();
  const [search] = createSearchParams(channelDetailSearch);
  const legacyChannel = (id: string): SplitContent => {
    const params: Record<string, string> = {};
    if (search.messageId) params[CHANNEL_URL_PARAMS.message] = search.messageId;
    if (search.threadId) params[CHANNEL_URL_PARAMS.thread] = search.threadId;
    return { type: 'channel', id, params };
  };

  return (
    <Show when={params.channelId} fallback={<LegacyChannelsView />}>
      {(channelId) => <RedirectSplit to={legacyChannel(channelId())} />}
    </Show>
  );
}

export const ChannelsRouteView = withAuth(() => {
  const params = useParams<{ channelId?: string }>();
  const detailRequested = () => typeof params.channelId === 'string';

  return (
    <NewAppView
      id="channels"
      detailDesktopOnly
      detailRequested={detailRequested}
      detailFallback={<ChannelsLegacyRouteView />}
      fallback={<LegacyChannelsView />}
    >
      <ChannelsView />
    </NewAppView>
  );
});

export const channelDetailRoute = defineRoute({
  id: 'channels-channel',
  path: ':channelId',
  params: z.object({ channelId: z.string().min(1) }),
  component: ChannelDetailRouteView,
  externalSearch: ['channel_message_id', 'channel_thread_id'],
  remountKey: ({ channelId }) => channelId,
  claim: ({ channelId }) => ({
    namespace: 'block',
    id: `channel:${channelId}`,
  }),
});

export const channelsSplitRoute = defineRoute({
  id: 'view-channels',
  path: 'channels',
  component: ChannelsRouteView,
  search: '*' as const,
  children: [channelDetailRoute],
});
