import {
  globalSplitManager,
  setGlobalSplitManager,
} from '@app/signal/splitLayout';
import { GlobalAppStateProvider } from '@components/app/GlobalAppState';
import { createRoutedSplitLayoutWithRouter } from '@components/app/split-layout/tests/fixtures';
import { createBlockOrchestrator } from '@core/orchestrator';
import { createNotificationSource } from '@notifications';
import { onCleanup, type ParentProps } from 'solid-js';

/** Actual app routing boundary; destination blocks and remote services are not mounted. */
export function NavigationBoundary(props: ParentProps) {
  const orchestrator = createBlockOrchestrator();
  const { manager, router } = createRoutedSplitLayoutWithRouter(
    orchestrator,
    '/home'
  );
  const notificationSource = createNotificationSource(undefined, () => false);
  setGlobalSplitManager(manager);
  onCleanup(() => {
    if (globalSplitManager() === manager) setGlobalSplitManager(undefined);
    router.dispose();
  });
  return (
    <GlobalAppStateProvider
      blockOrchestrator={orchestrator}
      notificationSource={notificationSource}
    >
      {props.children}
      <output data-split-targets data-ready={router.ready()}>
        {JSON.stringify(manager.splits().map((split) => split.content))}
      </output>
    </GlobalAppStateProvider>
  );
}
