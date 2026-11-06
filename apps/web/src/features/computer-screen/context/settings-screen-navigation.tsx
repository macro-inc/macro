import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableTeamAgents } from '@core/constant/featureFlags';
import {
  createContext,
  createEffect,
  createSignal,
  type ParentProps,
  useContext,
} from 'solid-js';

/** Carries a runtime-card selection to Settings within one application frame. */
export function SettingsScreenNavigationProvider(props: ParentProps) {
  const flag = useFeatureFlag(enableTeamAgents);
  const [requestedHarness, setRequestedHarness] = createSignal<string>();
  createEffect(() => {
    if (flag().loading || !flag().enabled) setRequestedHarness(undefined);
  });
  return (
    <SettingsScreenNavigationContext.Provider
      value={{
        requestedHarness,
        request: (harnessId: string) => {
          if (!flag().loading && flag().enabled) setRequestedHarness(harnessId);
        },
        consume: (harnessId: string) => {
          if (requestedHarness() === harnessId) setRequestedHarness(undefined);
        },
      }}
    >
      {props.children}
    </SettingsScreenNavigationContext.Provider>
  );
}

const SettingsScreenNavigationContext = createContext<{
  requestedHarness(): string | undefined;
  request(harnessId: string): void;
  consume(harnessId: string): void;
}>();
export function useOptionalSettingsScreenNavigation() {
  return useContext(SettingsScreenNavigationContext);
}
export function useSettingsScreenNavigation() {
  const navigation = useOptionalSettingsScreenNavigation();
  if (!navigation)
    throw new Error(
      'Screen navigation requires SettingsScreenNavigationProvider'
    );
  return navigation;
}
