import '@fontsource-variable/inter';
import '../../../../index.css';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { Button } from '@ui';
import { render } from 'solid-js/web';
import { macroLightTheme } from '../../../theme/themes/macro-light';
import { useSettingsComputerScreen } from '../../context/settings-screen-context';
import { SettingsComputerScreen } from '../../settings-computer-screen';
import {
  completeLookup,
  connections,
  directoryLoads,
  harnessId,
  lookups,
  requests,
  restoreDirectoryService,
} from './scenario';

document.documentElement.dataset.themeLight = 'true';
for (const [token, value] of Object.entries(macroLightTheme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}

function Actions() {
  const screen = useSettingsComputerScreen();
  return (
    <div class="space-y-4 p-4">
      <p>Settings content remains mounted</p>
      <Button
        disabled={!screen}
        onClick={() => screen?.openAgentComputer('fixture-agent')}
      >
        Open agent computer
      </Button>
      <Button disabled={!screen} onClick={() => screen?.openHarness(harnessId)}>
        Open runtime computer
      </Button>
      <Button onClick={completeLookup}>Finish lookup</Button>
      <Button onClick={restoreDirectoryService}>
        Restore directory service
      </Button>
    </div>
  );
}

const client = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
const root = document.getElementById('root');
if (root)
  render(
    () => (
      <QueryClientProvider client={client}>
        <div class="h-dvh" data-testid="settings-screen-host">
          <SettingsComputerScreen>
            <Actions />
          </SettingsComputerScreen>
        </div>
        <output aria-label="Transport history">
          {connections().join(',')}
        </output>
        <output aria-label="Discovery requests">{lookups()}</output>
        <output aria-label="Directory requests">{directoryLoads()}</output>
        <output aria-label="Submitted request levels">
          {requests().join(',')}
        </output>
      </QueryClientProvider>
    ),
    root
  );
