import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { globalSplitManager } from '@app/signal/splitLayout';
import { SidebarOpenInSplitMenu } from '@components/app/app-sidebar/sidebar';
import { rememberBootShell } from '@components/app/boot-shell';
import { UserIcon } from '@core/component/UserIcon';
import { useSettingsState } from '@core/constant/SettingsState';
import { useSettingsTabAvailable } from '@core/constant/settingsTabsConfig';
import { useEmail, useUserId } from '@core/context/user';
import { TOKENS } from '@core/hotkey/tokens';
import DeviceMobileDownloadIcon from '@icon/device-mobile-download.svg';
import GearIcon from '@phosphor/gear.svg';
import GearFillIcon from '@phosphor-fill/gear-fill.svg';
import { isRealNamePart, useOwnUserName } from '@queries/auth/user-name-self';
import { Button, cn, pressHandlers } from '@ui';
import { createEffect, createMemo, Show } from 'solid-js';
import { NavGlyph } from './nav-glyph';

/**
 * Sizes the gear and punches a gap around the avatar badge (16px, centred at
 * 22px,22px of the 24px glyph), so the badge reads on any button background.
 */
const AVATAR_CUTOUT =
  'size-6 [mask-image:radial-gradient(circle_at_22px_22px,transparent_10px,black_10.5px)]';

const SETTINGS_CONTENT = { type: 'component', id: 'settings' } as const;

const isSettingsActive = () => {
  const content = globalSplitManager()?.activeSplit()?.content();
  return (
    content?.type === SETTINGS_CONTENT.type &&
    content.id === SETTINGS_CONTENT.id
  );
};

/**
 * Get the mobile app: opens the Mobile App settings page, which carries the
 * App Store QR code. Hidden wherever that page is unavailable, e.g. inside
 * the native app.
 */
const MobileAppButton = () => {
  const analytics = useAnalytics();
  const { openSettings, openSettingsInSplit, activeTabId } = useSettingsState();
  const isTabAvailable = useSettingsTabAvailable();

  const isActive = () => isSettingsActive() && activeTabId() === 'Mobile App';

  createEffect(() =>
    rememberBootShell({ mobileApp: isTabAvailable('Mobile App') })
  );

  const open = (event: MouseEvent) => {
    event.preventDefault();
    analytics.track('sidebar_click', { view: 'mobile-app' });
    if (event.shiftKey) openSettingsInSplit('Mobile App');
    else openSettings('Mobile App');
  };

  return (
    <Show when={isTabAvailable('Mobile App')}>
      <Button
        variant="ghost"
        size="icon-md"
        class={cn(
          'size-10 cursor-default rounded-xl',
          isActive() && 'bg-hover text-ink'
        )}
        label="Get the mobile app"
        tooltip="Get the mobile app"
        tooltipPlacement="right"
        draggable={false}
        aria-current={isActive() ? 'page' : undefined}
        data-active={isActive() ? '' : undefined}
        data-sidebar-next-item="mobile-app"
        {...pressHandlers(open)}
      >
        <NavGlyph icon={DeviceMobileDownloadIcon} class="size-5" />
      </Button>
    </Show>
  );
};

/**
 * The rail's bottom actions: the mobile app link, then Settings, opened like
 * any other rail view. The gear carries the signed-in account's photo as a
 * badge, so people with several accounts can still tell which one they are in.
 */
export const FooterActions = (props: {
  onMenuOpenChange?: (open: boolean) => void;
}) => {
  const analytics = useAnalytics();
  const { openSettings, openSettingsInSplit, settingsOpen, activeTabId } =
    useSettingsState();
  const userId = useUserId();
  const email = useEmail();
  const userName = useOwnUserName();

  // Prefer the user's real name (first/last); fall back to their email.
  const accountName = createMemo(() => {
    const name = userName();
    const parts = [name?.first_name, name?.last_name]
      .map((part) => part?.trim())
      .filter((part): part is string => isRealNamePart(part));
    return parts.length > 0 ? parts.join(' ') : email();
  });

  // An open settings split keeps its section; a fresh open lands on Account.
  const currentTab = () => (settingsOpen() ? activeTabId() : undefined);

  const open = (event: MouseEvent) => {
    event.preventDefault();
    analytics.track('sidebar_click', { view: 'settings' });
    if (event.shiftKey) openSettingsInSplit(currentTab());
    else openSettings(currentTab());
  };

  return (
    <div class="flex w-full shrink-0 flex-col items-center gap-1">
      <MobileAppButton />
      <SidebarOpenInSplitMenu
        content={() => SETTINGS_CONTENT}
        // Route through settings state so the menu reuses an open settings
        // split (there is only ever one) and keeps its section.
        onOpenCurrentSplit={() => openSettings(currentTab())}
        onOpenNewSplit={() => openSettingsInSplit(currentTab())}
        onOpenChange={props.onMenuOpenChange}
        triggerClass="size-10"
      >
        <Button
          variant="ghost"
          size="icon-md"
          class={cn(
            'size-10 cursor-default rounded-xl',
            isSettingsActive() && 'bg-hover text-ink'
          )}
          label="Settings"
          aria-description={
            accountName() ? `Signed in as ${accountName()}` : undefined
          }
          tooltip="Settings"
          tooltipPlacement="right"
          hotkey={TOKENS.global.toggleSettings}
          draggable={false}
          aria-current={isSettingsActive() ? 'page' : undefined}
          data-active={isSettingsActive() ? '' : undefined}
          data-sidebar-next-item="settings"
          {...pressHandlers(open)}
        >
          <div class="pointer-events-none relative size-6">
            <NavGlyph
              icon={GearIcon}
              iconActive={GearFillIcon}
              filled={isSettingsActive()}
              class={AVATAR_CUTOUT}
            />
            <div class="absolute -right-1.5 -bottom-1.5 size-4 rounded-full">
              <Show
                when={userId()}
                fallback={<div class="size-full rounded-full bg-ink/10" />}
              >
                {(id) => (
                  <UserIcon
                    id={id()}
                    size="fill"
                    suppressClick
                    showTooltip={false}
                  />
                )}
              </Show>
            </div>
          </div>
        </Button>
      </SidebarOpenInSplitMenu>
    </div>
  );
};
