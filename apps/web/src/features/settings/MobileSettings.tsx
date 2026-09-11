import { useLogout } from '@core/auth/logout';
import { UserIcon } from '@core/component/UserIcon';
import { useSettingsTabs } from '@core/constant/settingsTabsConfig';
import { useEmail, useUserId } from '@core/context/user';
import { isRealNamePart, useOwnUserName } from '@queries/auth/user-name-self';
import { Show, Suspense } from 'solid-js';
import { useMobileSettings } from './context/mobile-settings';
import { MobileSettingsSheet } from './MobileSettingsSheet';
import { SettingsTabContent } from './SettingsTabContent';

export function MobileSettings() {
  const settings = useMobileSettings();
  const { groups } = useSettingsTabs();
  const userId = useUserId();
  const email = useEmail();
  const name = useOwnUserName();
  const logout = useLogout();
  const displayName = () => {
    const value = name();
    return (
      [value?.first_name, value?.last_name].filter(isRealNamePart).join(' ') ||
      email()?.split('@')[0] ||
      'Your account'
    );
  };
  const mobileGroups = () => {
    const general =
      groups().find((group) => group.label === 'General')?.items ?? [];
    const preferences = general.filter((item) =>
      ['Appearance', 'Notifications'].includes(item.tab)
    );
    return [
      {
        label: 'Account',
        items: general.filter((item) => !preferences.includes(item)),
      },
      { label: 'Preferences', items: preferences },
      ...groups().filter((group) => group.label !== 'General'),
    ].filter((group) => group.items.length > 0);
  };

  return (
    <MobileSettingsSheet
      open={settings?.open() ?? false}
      page={settings?.page()}
      groups={mobileGroups()}
      name={displayName()}
      email={email() ?? ''}
      avatar={
        <Suspense fallback={<span>{displayName().slice(0, 1)}</span>}>
          <Show
            when={userId()}
            keyed
            fallback={<span>{displayName().slice(0, 1)}</span>}
          >
            {(id) => (
              <UserIcon id={id} size="fill" suppressClick showTooltip={false} />
            )}
          </Show>
        </Suspense>
      }
      onClose={() => settings?.close()}
      onNavigate={(page) => settings?.selectPage(page)}
      onLogout={() => {
        void logout();
      }}
      renderPage={(page) => <SettingsTabContent tab={page} />}
    />
  );
}
