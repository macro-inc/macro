import { withAnalytics } from '@coparse/analytics';
import {
  DEV_MODE_ENV,
  ENABLE_AI_MEMORY,
  EXPERIMENTAL_DARK_MODE,
} from '@core/constant/featureFlags';
import {
  setSettingsOpen,
  useSettingsState,
} from '@core/constant/SettingsState';
import { TOKENS } from '@core/hotkey/tokens';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import { useOrganizationName } from '@core/user';
import Dialog from '@corvu/dialog';
import BellRinging from '@icon/regular/bell-ringing.svg';
import CreditCard from '@icon/regular/credit-card.svg';
import DeviceMobile from '@icon/regular/device-mobile.svg';
import CyberMan from '@icon/regular/head-circuit.svg';
import Palette from '@icon/regular/palette.svg';
import UserCircle from '@icon/regular/user-circle.svg';
import UsersThree from '@icon/regular/users-three.svg';
import XIcon from '@icon/regular/x.svg';
import { MacroPermissions, usePermissions } from '@service-gql/client';
import { registerHotkey } from 'core/hotkey/hotkeys';
import { createSignal, Show } from 'solid-js';
import MacroJump from '../MacroJump';
import { Account } from './Account';
import { AiMemory } from './AiMemory/AiMemory';
import { Appearance } from './Appearance';
import { Mobile } from './Mobile';
import { Notification } from './Notification';
import Organization from './Organization/Organization';
import { Subscription } from './Subscription';

export const [viewportOffset, setViewportOffset] = createSignal(0);

const { track, TrackingEvents } = withAnalytics();
export function Settings() {
  const {
    settingsOpen,
    closeSettings,
    activeTabId,
    setActiveTabId,
    toggleSettings,
  } = useSettingsState();
  const permissions = usePermissions();
  const orgName = useOrganizationName();

  registerHotkey({
    hotkeyToken: TOKENS.global.toggleSettings,
    hotkey: ';',
    scopeId: 'global',
    description: () => {
      return settingsOpen() ? 'Close Settings Panel' : 'Open Settings Panel';
    },
    keyDownHandler: () => {
      toggleSettings();
      return true;
    },
  });

  let settingsContentEl!: HTMLDivElement;

  return (
    <Dialog
      open={settingsOpen()}
      onOpenChange={setSettingsOpen}
      onEscapeKeyDown={closeSettings}
      trapFocus={true}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="dialog-overlay fixed inset-0 z-modal-overlay w-full bg-modal-overlay" />
        <Dialog.Content
          class="dialog-content bg-dialog text-ink sm:rounded-lg fixed sm:left-1/2 sm:top-1/2 z-modal sm:-translate-x-1/2 sm:-translate-y-1/2 w-dvw sm:w-[75vw] flex flex-col sm:flex-row sm:ring-1 ring-edge sm:shadow-2xl"
          style={{
            height: isMobileWidth() ? `calc(100dvh)` : '75dvh',
            top: isMobileWidth()
              ? `calc(${viewportOffset()}px + env(safe-area-inset-top))`
              : '50%',
          }}
          ref={settingsContentEl}
        >
          <div class="sm:h-full w-full rounded-l-lg sm:flex-1 sm:min-w-[15%] sm:max-w-[20%] bg-edge/15">
            <nav class="relative h-full flex-col sm:border-r border-b border-ink/10">
              <div class="flex justify-between items-center">
                <div class="px-3 py-3 text-xs text-ink-muted font-medium">
                  Settings
                </div>
                <Show when={isMobileWidth()}>
                  <XIcon
                    width={16}
                    height={16}
                    class="text-ink-muted cursor-default mr-2 ml-1"
                    onClick={closeSettings}
                  />
                </Show>
              </div>
              <div class="flex flex-col px-2 py-[3px] gap-[3px]">
                {/* Account tab - always shown */}
                <Show when={true}>
                  <button
                    onClick={() => {
                      setActiveTabId('Account');
                      track(TrackingEvents.SETTINGS.CHANGETAB, {
                        tab: 'Account',
                      });
                    }}
                    class={`
                    relative font-medium align-middle select-none
                    flex flex-row justify-start items-center
                    h-8 hover:bg-hover hover-transition-bg px-1 rounded-md
                    ${'Account' === activeTabId() ? 'text-ink cursor-default bg-active' : ''}
                  `}
                  >
                    <div class="line-clamp-1 text-sm flex-grow">
                      <div class="flex items-center gap-1">
                        <UserCircle class="w-5 h-5" />
                        <div>Account</div>
                      </div>
                    </div>
                  </button>
                </Show>

                {/* Subscription tab */}
                <Show when={!orgName() && !isNativeMobilePlatform()}>
                  <button
                    onClick={() => {
                      setActiveTabId('Subscription');
                      track(TrackingEvents.SETTINGS.CHANGETAB, {
                        tab: 'Subscription',
                      });
                    }}
                    class={`
                    relative font-medium align-middle select-none
                    flex flex-row justify-start items-center
                    h-8 hover:bg-hover hover-transition-bg px-1 rounded-md
                    ${'Subscription' === activeTabId() ? 'text-ink cursor-default bg-active' : ''}
                  `}
                  >
                    <div class="line-clamp-1 text-sm flex-grow">
                      <div class="flex items-center gap-1">
                        <CreditCard class="w-5 h-5" />
                        <div>Subscription</div>
                      </div>
                    </div>
                  </button>
                </Show>

                {/* Organization tab */}
                <Show
                  when={
                    orgName() &&
                    permissions()?.includes(MacroPermissions.WriteItPanel)
                  }
                >
                  <button
                    onClick={() => {
                      setActiveTabId('Organization');
                      track(TrackingEvents.SETTINGS.CHANGETAB, {
                        tab: 'Organization',
                      });
                    }}
                    class={`
                    relative font-medium align-middle select-none
                    flex flex-row justify-start items-center
                    h-8 hover:bg-hover hover-transition-bg px-1 rounded-md
                    ${'Organization' === activeTabId() ? 'text-ink cursor-default bg-active' : ''}
                  `}
                  >
                    <div class="line-clamp-1 text-sm flex-grow">
                      <div class="flex items-center gap-1">
                        <UsersThree class="w-5 h-5" />
                        <div>Organization</div>
                      </div>
                    </div>
                  </button>
                </Show>

                {/* Appearance tab */}
                <Show when={EXPERIMENTAL_DARK_MODE}>
                  <button
                    onClick={() => {
                      setActiveTabId('Appearance');
                      track(TrackingEvents.SETTINGS.CHANGETAB, {
                        tab: 'Appearance',
                      });
                    }}
                    class={`
                    relative font-medium align-middle select-none
                    flex flex-row justify-start items-center
                    h-8 hover:bg-hover hover-transition-bg px-1 rounded-md
                    ${'Appearance' === activeTabId() ? 'text-ink cursor-default bg-active' : ''}
                  `}
                  >
                    <div class="line-clamp-1 text-sm flex-grow">
                      <div class="flex items-center gap-1">
                        <Palette class="w-5 h-5" />
                        <div>Appearance</div>
                      </div>
                    </div>
                  </button>
                </Show>

                {/* Notification tab */}
                <button
                  onClick={() => {
                    setActiveTabId('Notification');
                    track(TrackingEvents.SETTINGS.CHANGETAB, {
                      tab: 'Notification',
                    });
                  }}
                  class={`
                    relative font-medium align-middle select-none
                    flex flex-row justify-start items-center
                    h-8 hover:bg-hover hover-transition-bg px-1 rounded-md
                    ${'Notification' === activeTabId() ? 'text-ink cursor-default bg-active' : ''}
                  `}
                >
                  <div class="line-clamp-1 text-sm flex-grow">
                    <div class="flex items-center gap-1">
                      <BellRinging class="w-5 h-5" />
                      <div>Notification</div>
                    </div>
                  </div>
                </button>

                {/* Mobile tab */}
                <Show when={!!isNativeMobilePlatform() && DEV_MODE_ENV}>
                  <button
                    onClick={() => {
                      setActiveTabId('Mobile');
                      track(TrackingEvents.SETTINGS.CHANGETAB, {
                        tab: 'Mobile',
                      });
                    }}
                    class={`
                    relative font-medium align-middle select-none
                    flex flex-row justify-start items-center
                    h-8 hover:bg-hover hover-transition-bg px-1 rounded-md
                    ${'Mobile' === activeTabId() ? 'text-ink cursor-default bg-active' : ''}
                  `}
                  >
                    <div class="line-clamp-1 text-sm flex-grow">
                      <div class="flex items-center gap-1">
                        <DeviceMobile class="w-5 h-5" />
                        <div>Mobile Dev Tools</div>
                      </div>
                    </div>
                  </button>
                </Show>
                <Show when={ENABLE_AI_MEMORY}>
                  <button
                    onClick={() => {
                      setActiveTabId('AI Memory');
                      track(TrackingEvents.SETTINGS.CHANGETAB, {
                        tab: 'AI Memory',
                      });
                    }}
                    class={`
                    relative font-medium align-middle select-none
                    flex flex-row justify-start items-center
                    h-8 hover:bg-hover hover-transition-bg px-1 rounded-md
                    ${'AI Memory' === activeTabId() ? 'text-ink cursor-default bg-active' : ''}
                  `}
                  >
                    <div class="line-clamp-1 text-sm flex-grow">
                      <div class="flex items-center gap-1">
                        <CyberMan class="w-5 h-5" />
                        <div>AI Memory</div>
                      </div>
                    </div>
                  </button>
                </Show>
              </div>
            </nav>
          </div>
          <div class="flex-1 p-6 overflow-y-scroll">
            {/* Use switch/case approach for the content instead of using tabs array */}
            {(() => {
              switch (activeTabId()) {
                case 'Account':
                  return <Account />;
                case 'Subscription':
                  return (
                    <Show when={!orgName()}>
                      <Subscription />
                    </Show>
                  );
                case 'Organization':
                  return (
                    <Show
                      when={
                        orgName() &&
                        permissions()?.includes(MacroPermissions.WriteItPanel)
                      }
                    >
                      <Organization />
                    </Show>
                  );
                case 'Appearance':
                  return (
                    <Show when={EXPERIMENTAL_DARK_MODE}>
                      <Appearance />
                    </Show>
                  );
                case 'Notification':
                  return <Notification />;

                case 'Mobile':
                  return (
                    <Show when={!!isNativeMobilePlatform() && DEV_MODE_ENV}>
                      <Mobile />
                    </Show>
                  );
                case 'AI Memory':
                  return (
                    <Show when={ENABLE_AI_MEMORY}>
                      <AiMemory />
                    </Show>
                  );
                default:
                  return <Account />;
              }
            })()}
          </div>
        </Dialog.Content>
        <MacroJump tabbableParent={() => settingsContentEl} />
      </Dialog.Portal>
    </Dialog>
  );
}
