import { ViewBreadcrumbs, ViewShell } from '@app/components/view-shell';
import { getViewPreset } from '@app/features/next-soup/sidebar/soup-filter-presets';
import { SoupRowMetadataProvider } from '@app/features/next-soup/soup-view/soup-row-metadata-provider';
import { SoupView } from '@app/features/next-soup/soup-view/soup-view';
import { callsTour } from '@app/features/next-soup/tour';
import { ViewTour } from '@app/features/tours/ViewTour';
import {
  SplitRouter,
  useNavigate,
  usePaneHistory,
  useParams,
} from '@app/lib/split-router';
import { callsRoute } from '@app/routes/routes';
import { SplitPanel } from '@components/app/split-panel';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { type JSX, Show, Suspense } from 'solid-js';
import { CallsHeader } from '../components/calls-header';
import { CallsSidebar } from '../components/calls-sidebar';

/**
 * Calls list. Desktop navigates and filters from a sidebar; touch keeps the
 * shared soup header with pill tabs.
 */
export function CallsView() {
  const preset = getViewPreset('calls');
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
  const list = (header?: JSX.Element) => (
    <SoupView
      viewName="Calls"
      initialFilters={preset?.filters}
      initialClientFilters={preset?.clientFilters}
      initialGroupBy={preset?.groupBy}
      tour={<ViewTour tour={callsTour} />}
      header={header}
      renderContent={(list) => <SplitRouter.Outlet fallback={list} />}
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
            asidePreferenceKey="calls"
            resizable
            aside={{ preserveDuringResize: false }}
          >
            <Show when={!isTouchDevice()}>
              <ViewShell.Aside>
                <Suspense>
                  <SoupRowMetadataProvider>
                    <CallsSidebar onNavigate={openList} />
                  </SoupRowMetadataProvider>
                </Suspense>
              </ViewShell.Aside>
            </Show>
            <ViewShell.Main>
              {list(
                !isTouchDevice() ? (
                  <Suspense>
                    <CallsHeader />
                  </Suspense>
                ) : undefined
              )}
            </ViewShell.Main>
          </ViewShell.Root>
        </SplitPanel.Body>
      </SplitPanel.Root>
    </ViewBreadcrumbs.Root>
  );
}
