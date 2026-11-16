// The channel input's modules import each other; evaluating `Input` before
// either lazy screen below is the order the app's entry gives them.
import '@channel/Input/Input';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { queryClient } from '@queries/client';
import { QueryClientProvider } from '@tanstack/solid-query';
import { render } from 'solid-js/web';
import '@fontsource-variable/inter';
import '../../../../index.css';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { Route, Router } from '@solidjs/router';
import { Layer } from '@ui/components/Layer';
import { createSignal, ErrorBoundary, lazy, Match, Switch } from 'solid-js';
import { SettingsPage } from '../../primitives';
import { GetComputerEntry } from '../views/get-computer-entry';
import { MacroComputers } from '../views/MacroComputers';
import {
  agentsPageOpened,
  harnesses,
  settingsOpened,
} from './stubs/fixture-state';

// The fixture uses the same touch variant switch as the app entry point.
document.documentElement.dataset.touchDevice = String(isTouchDevice());

// Loaded once Try it or Create agent leaves the dialog, as the app does.
const Composer = lazy(() => import('./composer'));
const AgentSettings = lazy(() => import('./agent-settings'));
// Both are large module graphs; start loading them while the flow runs.
fireAndForget(Composer.preload(), 'computers-fixture');
fireAndForget(AgentSettings.preload(), 'computers-fixture');

// A computer setup notification arriving, as the realtime feed delivers it.
// It goes through the app's own handler: the computers list refreshes and
// the notice shows.
window.computerFixture.notify = async (content) => {
  const { handleNotificationUpdate } = await import(
    '../../../notifications/use-notification-updates'
  );
  handleNotificationUpdate({
    id: `setup-${content.computerId}-${content.outcome.kind}`,
    entity_id: 'team-1',
    entity_type: 'team',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    state: 'unseen',
    sent: true,
    notification_event_type: 'computer_setup',
    notification_metadata: { tag: 'computer_setup', content },
  });
};

function Fixture() {
  // Machines owns the buy flow's open state, as Harness does.
  const [buying, setBuying] = createSignal(false);
  return (
    <QueryClientProvider client={queryClient}>
      <Layer>
        <Switch
          fallback={
            <SettingsPage
              title="Machines"
              description="Providers and machines your agents can run on."
            >
              <GetComputerEntry onGet={() => setBuying(true)} />
              <MacroComputers
                harnesses={harnesses()}
                buying={buying()}
                onBuyingChange={setBuying}
              />
            </SettingsPage>
          }
        >
          <Match when={agentsPageOpened()}>
            {/* A failure shows its message, so a test reports it. No Suspense:
                the screens show as soon as they load. */}
            <ErrorBoundary fallback={(error) => <pre>{String(error)}</pre>}>
              <Composer />
            </ErrorBoundary>
          </Match>
          <Match when={settingsOpened() === 'Agents'}>
            {/* A failure shows its message, so a test reports it. No Suspense:
                the screens show as soon as they load. */}
            <ErrorBoundary fallback={(error) => <pre>{String(error)}</pre>}>
              <AgentSettings />
            </ErrorBoundary>
          </Match>
        </Switch>
        <ToastRegion />
      </Layer>
    </QueryClientProvider>
  );
}

const root = document.getElementById('root');
if (root)
  render(
    () => (
      <Router root={Fixture}>
        <Route path="*all" component={() => null} />
      </Router>
    ),
    root
  );
