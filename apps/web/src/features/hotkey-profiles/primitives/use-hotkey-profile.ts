import {
  COMMAND_MENU_CATEGORY_SCOPE,
  GO_TO_COMMAND_SCOPE,
} from '@app/constants/hotkeys';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import type { HotkeyProfileTag } from '@core/hotkey/types';
import { isScopeInActiveBranch, runTokenCommand } from '@core/hotkey/utils';
import { onCleanup } from 'solid-js';
import { useHotkeyProfiles } from '../context/hotkey-profiles-context';
import type {
  HotkeyProfile,
  ProfileActionHandler,
  ProfileLeader,
} from '../core/profiles';

type Registration = {
  /** The scope the view's own keys live in. */
  scopeId: string;
  /** Whether the view has the keyboard, e.g. its split is active. */
  enabled: () => boolean;
};

export type ViewProfileRegistration<Action extends string> = Registration & {
  context: 'view';
  actions: Record<Action, ProfileActionHandler>;
};

export type DetailProfileRegistration = Registration & { context: 'detail' };

/**
 * Registers a profile's keys for one context of a view. They run only while
 * the person has the profile on, and then take precedence over Macro's keys
 * in the scope (see HotkeyCommand.profile). Register beside the view's own
 * keys, so a profile key is in the same scope as the key it replaces.
 */
export function useHotkeyProfile<Action extends string>(
  profile: HotkeyProfile<Action>,
  registration: ViewProfileRegistration<Action> | DetailProfileRegistration
) {
  const profiles = useHotkeyProfiles();
  const tag: HotkeyProfileTag = { id: profile.id, label: profile.label };
  const isOn = () =>
    profiles.activeProfile(profile.domain) === profile.id &&
    registration.enabled();
  // A key after Macro's g or o runs only when that leader was pressed here.
  const isOnHere = () => isOn() && isScopeInActiveBranch(registration.scopeId);
  const group = createHotkeyGroup();

  const profileLeaderScopes = new Map<ProfileLeader, string>();
  const leaderScope = (leader: ProfileLeader) => {
    if (leader === 'g') return GO_TO_COMMAND_SCOPE;
    if (leader === 'o') return COMMAND_MENU_CATEGORY_SCOPE;
    const existing = profileLeaderScopes.get(leader);
    if (existing) return existing;
    const { commandScopeId } = group.add(
      registerHotkey({
        hotkey: leader,
        scopeId: registration.scopeId,
        description: profile.label,
        activateCommandScope: true,
        keyDownHandler: () => true,
        condition: isOn,
        profile: tag,
        registrationType: 'add',
        hide: true,
      })
    );
    profileLeaderScopes.set(leader, commandScopeId);
    return commandScopeId;
  };

  for (const binding of profile.bindings) {
    const target = binding.target;
    let handler: (index: number, e?: KeyboardEvent) => boolean;
    if ('tokens' in target) {
      if (!target.contexts.includes(registration.context)) continue;
      handler = (_index, e) => runTokenCommand([...target.tokens], e);
    } else {
      if (registration.context !== 'view') continue;
      const run = registration.actions[target.action];
      handler = (index) => run(index);
    }
    binding.keys.forEach((key, index) => {
      const leader = typeof key === 'string' ? undefined : key[0];
      registerHotkey({
        scopeId: leader ? leaderScope(leader) : registration.scopeId,
        hotkey: typeof key === 'string' ? key : key[1],
        description: binding.description,
        condition: leader === 'g' || leader === 'o' ? isOnHere : isOn,
        keyDownHandler: (e) => handler(index, e),
        profile: tag,
        aliasOf: 'tokens' in target ? [...target.tokens] : undefined,
        // An existing action keeps its own command menu row, which then
        // shows this key.
        hide: 'tokens' in target,
        registrationType: 'add',
        sheetSection: 'view',
        runWithInputFocused: binding.whileTyping,
      }).withGroup(group);
    });
  }

  onCleanup(() => group.dispose());
}
