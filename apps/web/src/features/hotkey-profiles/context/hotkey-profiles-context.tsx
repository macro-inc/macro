import { createContext, useContext } from 'solid-js';
import type { HotkeyProfileDomain, HotkeyProfileId } from '../core/profiles';

/** The person's hotkey profile choices, one per view. */
export type HotkeyProfilesSource = {
  /**
   * The profile turned on for a view. Undefined means Macro's own keys,
   * including while the choice is still loading or failed to load.
   */
  activeProfile: (domain: HotkeyProfileDomain) => HotkeyProfileId | undefined;
  /** Whether the choices have loaded; until then setProfile does nothing. */
  ready: () => boolean;
  /** Turns a view's profile on, or back to Macro's keys with undefined. */
  setProfile: (
    domain: HotkeyProfileDomain,
    profileId: HotkeyProfileId | undefined
  ) => void;
};

const Context = createContext<HotkeyProfilesSource>();

export const HotkeyProfilesProvider = Context.Provider;

export function useHotkeyProfiles(): HotkeyProfilesSource {
  const source = useContext(Context);
  if (!source) throw new Error('HotkeyProfilesProvider is required');
  return source;
}
