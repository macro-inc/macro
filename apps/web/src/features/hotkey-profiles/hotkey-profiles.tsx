import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableHotkeyProfiles } from '@core/constant/featureFlags';
import { useIsAuthenticated } from '@core/context/user';
import type { ParentProps } from 'solid-js';
import { HotkeyProfilesProvider } from './context/hotkey-profiles-context';
import { createHotkeyProfilesSource } from './queries/hotkey-profiles-source';

/** Supplies the signed-in person's hotkey profile choices to the app. */
export function AppHotkeyProfilesProvider(props: ParentProps) {
  const flag = useFeatureFlag(enableHotkeyProfiles);
  const authenticated = useIsAuthenticated();
  const source = createHotkeyProfilesSource(
    () => flag().enabled && authenticated() === true
  );
  return (
    <HotkeyProfilesProvider value={source}>
      {props.children}
    </HotkeyProfilesProvider>
  );
}
