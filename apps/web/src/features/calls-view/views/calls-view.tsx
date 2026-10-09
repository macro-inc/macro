import { ViewShell } from '@app/components/view-shell';
import { getViewPreset } from '@app/features/next-soup/sidebar/soup-filter-presets';
import { SoupRowMetadataProvider } from '@app/features/next-soup/soup-view/soup-row-metadata-provider';
import { SoupView } from '@app/features/next-soup/soup-view/soup-view';
import { callsTour } from '@app/features/next-soup/tour';
import { ViewTour } from '@app/features/tours/ViewTour';
import { SplitPanel } from '@components/app/split-panel';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type JSX, Show, Suspense } from 'solid-js';
import { CallsHeader } from '../components/calls-header';
import { CallsSidebar } from '../components/calls-sidebar';

/**
 * Calls list. Desktop navigates and filters from a sidebar; touch keeps the
 * shared soup header with pill tabs.
 */
export function CallsView() {
  const preset = getViewPreset('calls');
  const list = (header?: JSX.Element) => (
    <SoupView
      viewName="Calls"
      initialFilters={preset?.filters}
      initialClientFilters={preset?.clientFilters}
      initialGroupBy={preset?.groupBy}
      tour={<ViewTour tour={callsTour} />}
      header={header}
    />
  );

  return (
    <Show when={!isTouchDevice()} fallback={list()}>
      <SplitPanel.Root>
        <SplitPanel.Body>
          <ViewShell.Root
            asidePreferenceKey="calls"
            resizable
            aside={{ preserveDuringResize: false }}
          >
            <ViewShell.Aside>
              <Suspense>
                <SoupRowMetadataProvider>
                  <CallsSidebar />
                </SoupRowMetadataProvider>
              </Suspense>
            </ViewShell.Aside>
            <ViewShell.Main>
              {list(
                <Suspense>
                  <CallsHeader />
                </Suspense>
              )}
            </ViewShell.Main>
          </ViewShell.Root>
        </SplitPanel.Body>
      </SplitPanel.Root>
    </Show>
  );
}
