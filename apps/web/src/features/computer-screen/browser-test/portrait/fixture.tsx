import '@fontsource-variable/inter';
import '../../../../index.css';
import { HeaderActionButton } from '@components/app/HeaderActionButton';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { UserCardDrawer } from '@core/component/UserCardDrawer';
import { UserIcon } from '@core/component/UserIcon';
import PhoneIcon from '@icon/system/regular/phone-call.svg';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { Show } from 'solid-js';
import { render } from 'solid-js/web';
import { ChannelComputerButton } from '../../../channel/Channel/ChannelComputerButton';
import { macroDarkTheme } from '../../../theme/themes/macro-dark';
import { macroLightTheme } from '../../../theme/themes/macro-light';
import { SettingsComputerScreen } from '../../settings-computer-screen';
import { connections, dmRequests } from './scenario';

const params = new URLSearchParams(location.search);
const theme = params.has('dark') ? macroDarkTheme : macroLightTheme;
for (const [token, value] of Object.entries(theme.colorTokens))
  document.documentElement.style.setProperty(`--color-${token}`, value);
document.documentElement.dataset.themeLight = String(!params.has('dark'));
const root = document.getElementById('root');
if (root)
  render(
    () => (
      <QueryClientProvider client={new QueryClient()}>
        <div class="h-dvh bg-panel text-ink">
          <SettingsComputerScreen>
            <Show
              when={params.has('dm')}
              fallback={
                <div class="p-8">
                  <div data-testid="portrait" class="inline-flex">
                    <UserIcon id="macro|agent@example.com" size="lg" />
                  </div>
                  <p>Agent portrait</p>
                </div>
              }
            >
              <div
                class="@container/split-header flex items-center justify-between gap-2 px-4 h-12 touch:h-14"
                data-testid="dm-header"
              >
                <span class="text-sm font-semibold">Assistant</span>
                <div class="flex items-center gap-2 touch:gap-1">
                  <HeaderActionGroup label="Conversation actions">
                    <HeaderActionButton
                      grouped
                      label="Call"
                      tooltip="Start Call"
                      icon={<PhoneIcon class="size-3.5 touch:size-6" />}
                      onClick={() => {}}
                    />
                    <ChannelComputerButton grouped channelId="channel-1" />
                  </HeaderActionGroup>
                </div>
              </div>
            </Show>
            <UserCardDrawer />
          </SettingsComputerScreen>
        </div>
        <p aria-label="Transport history">{connections().join(',')}</p>
        <p aria-label="DM requests">{dmRequests()}</p>
      </QueryClientProvider>
    ),
    root
  );
