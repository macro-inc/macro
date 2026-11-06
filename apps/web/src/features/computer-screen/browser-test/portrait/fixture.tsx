import '@fontsource-variable/inter';
import '../../../../index.css';
import { UserCardDrawer } from '@core/component/UserCardDrawer';
import { UserIcon } from '@core/component/UserIcon';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { render } from 'solid-js/web';
import { macroLightTheme } from '../../../theme/themes/macro-light';
import { SettingsComputerScreen } from '../../settings-computer-screen';
import { connections, dmRequests } from './scenario';

for (const [token, value] of Object.entries(macroLightTheme.colorTokens))
  document.documentElement.style.setProperty(`--color-${token}`, value);
document.documentElement.dataset.themeLight = 'true';
const root = document.getElementById('root');
if (root)
  render(
    () => (
      <QueryClientProvider client={new QueryClient()}>
        <div class="h-dvh bg-panel text-ink">
          <SettingsComputerScreen>
            <div class="p-8">
              <div data-testid="portrait" class="inline-flex">
                <UserIcon id="macro|agent@example.com" size="lg" />
              </div>
              <p>Agent portrait</p>
            </div>
            <UserCardDrawer />
          </SettingsComputerScreen>
        </div>
        <p aria-label="Transport history">{connections().join(',')}</p>
        <p aria-label="DM requests">{dmRequests()}</p>
      </QueryClientProvider>
    ),
    root
  );
