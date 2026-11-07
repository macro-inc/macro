import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableMacroComputers } from '@core/constant/featureFlags';
import {
  createContext,
  createEffect,
  createSignal,
  type ParentProps,
  useContext,
} from 'solid-js';

/** Carries a runtime-card selection to Settings within one application frame. */
export function SettingsScreenNavigationProvider(props: ParentProps) {
  const flag = useFeatureFlag(enableMacroComputers);
  const enabled = () => !flag().loading && flag().enabled;
  const [requestedControl, setRequestedControl] = createSignal(false);
  const [requestedHarness, setRequestedHarness] = createSignal<string>();
  createEffect(() => {
    if (!enabled()) setRequestedHarness(undefined);
  });
  return (
    <SettingsScreenNavigationContext.Provider
      value={{
        requestedHarness,
        requestedControl,
        request: (harnessId: string, control = false) => {
          if (!enabled()) return;
          setRequestedControl(control);
          setRequestedHarness(harnessId);
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
  requestedControl?(): boolean;
  request(harnessId: string, control?: boolean): void;
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
