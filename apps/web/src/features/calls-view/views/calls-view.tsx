import {
  CollectionPanes,
  ViewBreadcrumbs,
  ViewShell,
} from '@app/components/view-shell';
import { MobileListLayout } from '@app/components/view-shell/MobileListLayout';
import { useInlinePreviewLayout } from '@app/components/view-shell/use-inline-preview-layout';
import { getViewPreset } from '@app/features/next-soup/sidebar/soup-filter-presets';
import { SoupRowMetadataProvider } from '@app/features/next-soup/soup-view/soup-row-metadata-provider';
import { SoupView } from '@app/features/next-soup/soup-view/soup-view';
import { MobileSoupViewTabs } from '@app/features/next-soup/soup-view/soup-view-tabs';
import { callsTour } from '@app/features/next-soup/tour';
import { ViewTour } from '@app/features/tours/ViewTour';
import { TutorialRow } from '@app/features/video-tutorials';
import {
  SplitRouter,
  useNavigate,
  usePaneHistory,
  useParams,
} from '@app/lib/split-router';
import { callsCallRoute, callsRoute } from '@app/routes/routes';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { onMount, Suspense } from 'solid-js';
import { CallsHeader } from '../components/calls-header';
import { CallsSidebar } from '../components/calls-sidebar';

/**
 * Calls list. Desktop navigates and filters from a sidebar; touch keeps the
 * shared soup header with pill tabs.
 */
export function CallsView() {
  const preset = getViewPreset('calls');
  const panel = useSplitPanelOrThrow();
  const inlinePreviewLayout = useInlinePreviewLayout();
  onMount(() => panel.handle.updateMeta?.({ splitPanelLayout: 'composable' }));
  const params = useParams<{ callId?: string }>();
  const navigate = useNavigate();
  const history = usePaneHistory();
  const openList = () => {
    if (!params.callId) return;
    const snapshot = history();
    if (snapshot) {
      for (let index = snapshot.index - 1; index >= 0; index--) {
        const matches = snapshot.entries[index].location.route.matches;
        if (!matches.some((match) => match.id === callsRoute.id)) break;
        if (matches.at(-1)?.id === callsRoute.id) {
          fireAndForget(navigate(index - snapshot.index), 'calls-view');
          return;
        }
      }
    }
    fireAndForget(navigate({ route: callsRoute, params: {} }), 'calls-view');
  };
  const list = () => (
    <SoupView
      viewName="Calls"
      initialFilters={preset?.filters}
      initialClientFilters={preset?.clientFilters}
      initialGroupBy={preset?.groupBy}
      tour={<ViewTour tour={callsTour} />}
      header={
        isTouchDevice() ? (
          false
        ) : (
          <Suspense>
            <CallsHeader />
          </Suspense>
        )
      }
      onOpenEntity={(entity, event) => {
        if (
          !isTouchDevice() ||
          !inlinePreviewLayout() ||
          entity.type !== 'call' ||
          event?.shiftKey ||
          event?.metaKey ||
          event?.ctrlKey ||
          event?.altKey
        )
          return false;
        fireAndForget(
          navigate({ route: callsCallRoute, params: { callId: entity.id } }),
          'calls-view'
        );
        return true;
      }}
      listStart={<TutorialRow tutorial="calls" />}
      renderContent={(rows) => (
        <CollectionPanes
          hasDetail={!!params.callId}
          list={
            <MobileListLayout header={<MobileSoupViewTabs />}>
              {rows()}
            </MobileListLayout>
          }
        >
          <SplitRouter.Outlet />
        </CollectionPanes>
      )}
    />
  );

  return (
    <ViewBreadcrumbs.Root
      value={params.callId ? `call:${params.callId}` : 'calls-view'}
      onChange={(value) => {
        if (value === 'calls-view') openList();
      }}
    >
      <ViewBreadcrumbs.Item
        value="calls-view"
        order={0}
        metadata={{ type: 'calls' }}
      >
        {(item) => (
          <ViewBreadcrumbs.ReturnButton
            isActive={item.isActive()}
            onClick={item.onSelect}
            tooltip="Calls"
          >
            Calls
          </ViewBreadcrumbs.ReturnButton>
        )}
      </ViewBreadcrumbs.Item>
      <SplitPanel.Root>
        <SplitPanel.Body>
          <ViewShell.Root
            contentLayout="collection"
            asidePreferenceKey="calls"
            resizable
            aside={{ preserveDuringResize: false }}
          >
            <ViewShell.Aside>
              <Suspense>
                <SoupRowMetadataProvider>
                  <CallsSidebar onNavigate={openList} />
                </SoupRowMetadataProvider>
              </Suspense>
            </ViewShell.Aside>
            {list()}
          </ViewShell.Root>
        </SplitPanel.Body>
      </SplitPanel.Root>
    </ViewBreadcrumbs.Root>
  );
}
