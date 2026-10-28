import { isBotPrincipalId } from '@core/constant/macroAgent';
import { getDisplayName, getDisplayNameParts, tryMacroId } from '@core/user';
import { firstPartyBotName } from '@queries/bots/first-party-bot-name';
import { useBotProfile } from '@queries/bots/profiles';
import { queryReadyGate } from '@queries/gate';
import { type Accessor, createMemo, untrack } from 'solid-js';

/** Resolve user-property principals without treating bot IDs as email users. */
export function usePropertyUserDisplay(id: Accessor<string>) {
  const isAgent = () => isBotPrincipalId(id());
  const botId = () => (isAgent() ? id().replace(/^bot\|/, '') : '');
  const bot = createMemo(() =>
    isAgent() ? untrack(() => useBotProfile(botId)) : undefined
  );
  // Every data read is gated so property pills and hover cards never suspend
  // their surrounding task while resolving an agent's profile.
  const profile = () => {
    const source = bot();
    return source && queryReadyGate(source) ? source.data : undefined;
  };
  const userName = () =>
    getDisplayNameParts(tryMacroId(id()), { emailFallback: 'local-part' });
  const name = () =>
    isAgent()
      ? (profile()?.name ?? firstPartyBotName(id()) ?? 'Agent')
      : getDisplayName(tryMacroId(id()));

  return {
    name,
    shortName: () =>
      isAgent() ? name() : userName().firstName || userName().fullName,
    photoUrl: () => profile()?.avatarUrl,
  };
}
