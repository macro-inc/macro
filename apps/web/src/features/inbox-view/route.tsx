import {
  createSearchParams,
  defineRoute,
  useParams,
} from '@app/lib/split-router';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import {
  NewAppView,
  RedirectSplit,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { lazy, Show } from 'solid-js';
import { getViewPreset } from '../next-soup/sidebar/soup-filter-presets';
import { inboxPreviewLegacyTarget, inboxPreviewSearch } from './inbox-route';
import {
  type InboxPreviewRouteParams,
  inboxPreviewRouteParams,
} from './inbox-route-schema';

const SoupView = lazy(async () => ({
  default: (await import('../next-soup/soup-view/soup-view')).SoupView,
}));
const InboxView = lazy(async () => ({
  default: (await import('./inbox-view')).InboxView,
}));
const InboxDetailRouteView = lazy(async () => ({
  default: (await import('./inbox-view')).InboxDetailRouteView,
}));

function LegacyInboxView() {
  const preset = getViewPreset('inbox');
  return (
    <SoupView
      viewName={isTouchDevice() ? 'Notifications' : 'Home'}
      initialFilters={preset?.filters}
      initialClientFilters={preset?.clientFilters}
      initialGroupBy={preset?.groupBy}
      disableLocalSearch
    />
  );
}

function InboxLegacyRouteView() {
  const params = useParams<Partial<InboxPreviewRouteParams>>();
  const [search] = createSearchParams(inboxPreviewSearch);
  const legacyTarget = () => {
    const { blockType, previewId } = params;
    if (!blockType || !previewId) return;
    return inboxPreviewLegacyTarget({ blockType, previewId }, search);
  };

  return (
    <Show when={legacyTarget()} fallback={<LegacyInboxView />}>
      {(target) => <RedirectSplit to={target() as SplitContent} />}
    </Show>
  );
}

export const InboxRouteView = withAuth(() => {
  const params = useParams<Partial<InboxPreviewRouteParams>>();
  const detailRequested = () =>
    typeof params.blockType === 'string' &&
    typeof params.previewId === 'string';

  return (
    <NewAppView
      id="inbox"
      composableOnTouch
      detailDesktopOnly
      detailRequested={detailRequested}
      detailFallback={<InboxLegacyRouteView />}
      fallback={<LegacyInboxView />}
    >
      <InboxView />
    </NewAppView>
  );
});

export const inboxPreviewRoute = defineRoute({
  id: 'inbox-preview',
  path: ':blockType/:previewId',
  params: inboxPreviewRouteParams,
  component: InboxDetailRouteView,
  remountKey: ({ blockType, previewId }) => `${blockType}:${previewId}`,
  claim: ({ blockType, previewId }) => ({
    namespace: 'block',
    id: `${blockType}:${previewId}`,
  }),
});

export const inboxSplitRoute = defineRoute({
  id: 'view-inbox',
  path: 'inbox',
  component: InboxRouteView,
  search: '*' as const,
  children: [inboxPreviewRoute],
});
