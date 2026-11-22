// The channel input's modules import each other; evaluating `Input` before
// anything else is the order the app's entry gives them.
import '@channel/Input/Input';
import { applyTheme } from '@app/features/theme/utils/themeUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { queryClient } from '@queries/client';
import { QueryClientProvider } from '@tanstack/solid-query';
import { render } from 'solid-js/web';
import '@fontsource-variable/inter';
import '../../../../index.css';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { Route, Router } from '@solidjs/router';
import { Layer } from '@ui/components/Layer';
import { createSignal, Match, Switch } from 'solid-js';
import { SettingsPage } from '../../primitives';
import { GetComputerEntry } from '../views/get-computer-entry';
import { MacroComputers } from '../views/MacroComputers';
import { agentDmOpened, harnesses } from './stubs/fixture-state';

// `?theme=dark|light` for screenshots; unset keeps the fixture's default.
const theme = new URLSearchParams(location.search).get('theme');
if (theme) applyTheme(theme === 'dark' ? 'Macro Dark' : 'Macro Light');

// The fixture uses the same touch variant switch as the app entry point.
document.documentElement.dataset.touchDevice = String(isTouchDevice());

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
                // The guided variant stays reachable for its own tests.
                afterPurchase={
                  new URLSearchParams(location.search).get('after') === 'guided'
                    ? 'guided'
                    : 'ready'
                }
                harnesses={harnesses()}
                buying={buying()}
                onBuyingChange={setBuying}
              />
            </SettingsPage>
          }
        >
          <Match when={agentDmOpened()}>
            {(botId) => (
              <section aria-label="Direct message">DM with {botId()}</section>
            )}
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
