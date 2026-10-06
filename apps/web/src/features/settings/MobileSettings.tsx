import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useLogout } from '@core/auth/logout';
import { UserIcon } from '@core/component/UserIcon';
import { enableEmailSignatures } from '@core/constant/featureFlags';
import { useSettingsTabs } from '@core/constant/settingsTabsConfig';
import { useEmail, useUserId } from '@core/context/user';
import { isRealNamePart, useOwnUserName } from '@queries/auth/user-name-self';
import { Show, Suspense } from 'solid-js';
import { useMobileSettings } from './context/mobile-settings';
import { MobileSettingsSheet } from './MobileSettingsSheet';
import { SettingsTabContent } from './SettingsTabContent';

export function MobileSettings() {
  const settings = useMobileSettings();
  const signatures = useFeatureFlag(enableEmailSignatures);
  const { groups, searchGroups } = useSettingsTabs();
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

  return (
    <MobileSettingsSheet
      open={settings.open()}
      page={settings.page()}
      groups={groups()}
      searchGroups={searchGroups()}
      emailSignatures={signatures().enabled}
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
      onClose={settings.close}
      onNavigate={settings.selectPage}
      onLogout={() => {
        void logout();
      }}
      renderPage={(page) => <SettingsTabContent tab={page} />}
    />
  );
}
