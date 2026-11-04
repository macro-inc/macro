import {
  useSetUserHotkeyProfilesMutation,
  useUserHotkeyProfilesQuery,
} from '@queries/auth/user-hotkey-profiles';
import { queryReadyGate } from '@queries/gate';
import type { UserHotkeyProfiles } from '@service-auth/generated/schemas/userHotkeyProfiles';
import type { Accessor } from 'solid-js';
import { match } from 'ts-pattern';
import type { HotkeyProfilesSource } from '../context/hotkey-profiles-context';

/**
 * The person's profile choices from their account. While `enabled` is false,
 * loading, or failed, every view keeps Macro's keys.
 */
export function createHotkeyProfilesSource(
  enabled: Accessor<boolean>
): HotkeyProfilesSource {
  const query = useUserHotkeyProfilesQuery(enabled);
  const mutation = useSetUserHotkeyProfilesMutation();
  const profiles = (): UserHotkeyProfiles | undefined =>
    enabled() && queryReadyGate(query) ? query.data : undefined;

  return {
    activeProfile: (domain) => profiles()?.[domain] ?? undefined,
    ready: () => profiles() !== undefined,
    setProfile: (domain, profileId) => {
      const current = profiles();
      if (!current) return;
      const next = match(domain)
        .with('email', () => ({
          ...current,
          email: profileId === 'superhuman' ? profileId : null,
        }))
        .with('tasks', () => ({
          ...current,
          tasks: profileId === 'linear' ? profileId : null,
        }))
        .exhaustive(() => undefined);
      if (next) mutation.mutate(next);
    },
  };
}
