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
import { ErrorBoundary, lazy, Match, Switch } from 'solid-js';
import { SettingsPage } from '../../primitives';
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
window.computerFixture.notify = async (content) => {
  const { showComputerSetupToast } = await import(
    '../../../notifications/computer-setup-toast'
  );
  showComputerSetupToast(content);
};

function Fixture() {
  return (
    <QueryClientProvider client={queryClient}>
      <Layer>
        <Switch
          fallback={
            <SettingsPage
              title="Machines"
              description="Providers and machines your agents can run on."
            >
              <MacroComputers harnesses={harnesses()} />
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
