import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  type Entry,
  type SplitRoutes,
} from '@app/lib/split-router';
import { paneRoute } from '@app/routes/app-route';
import {
  appRoute,
  emailSplitRoute,
  emailThreadRoute,
  homeSplitRoute,
  legacyContentRoute,
  notFoundRoute,
} from '@app/routes/routes';
import { setGlobalSplitManager } from '@app/signal/splitLayout';
import {
  createSplitLayout,
  type SplitManager,
} from '@components/app/split-layout/layoutManager';
import { createAppPanePolicy } from '@components/app/split-layout/split-router/app-pane-policy';
import {
  resolveContentLocation,
  splitContentFromLocation,
} from '@components/app/split-layout/split-router/legacy-route';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createBlockOrchestrator } from '@core/orchestrator';
import { For, type ParentProps } from 'solid-js';

/** Real split routing and deduplication, with synthetic pane contents. */
export function PrivacyNavigationFixture(props: ParentProps) {
  let manager!: SplitManager;
  const routes: SplitRoutes = {
    definitions: [
      {
        ...appRoute,
        children: [
          homeSplitRoute,
          { ...emailSplitRoute, children: [emailThreadRoute] },
          legacyContentRoute,
          notFoundRoute,
        ],
      },
    ],
    defaultRoute: () => paneRoute({ id: 'view-home', params: {} }),
  };
  const router = createSplitRouter({
    routes,
    history: createMemoryHistory('/home'),
    paneStore: createMemoryPaneStore<Entry>(),
    policy: createAppPanePolicy({
      manager: () => manager,
      toContent: splitContentFromLocation,
      defaultLocation: () => ({ route: routes.defaultRoute() }),
      stacked: isTouchDevice,
    }),
  });
  manager = createSplitLayout(createBlockOrchestrator(), {
    router,
    toLocation: (content) => resolveContentLocation(router.routes, content),
    toContent: splitContentFromLocation,
    stacked: isTouchDevice,
  });
  setGlobalSplitManager(manager);
  if (new URLSearchParams(location.search).has('already-open')) {
    manager.openWithSplit(
      { type: 'email', id: '00000000-0000-4000-8000-000000000046' },
      { preferNewSplit: true, activate: false }
    );
  }
  return (
    <>
      {props.children}
      <div data-testid="panes" class="p-6 flex gap-4">
        <For each={manager.splits()}>
          {(split) => (
            <div
              data-testid="pane"
              data-content={split.content.id}
              data-active={manager.activeSplitId() === split.id}
            >
              {split.content.id}
            </div>
          )}
        </For>
      </div>
    </>
  );
}
