import { isBotPrincipalId } from '@core/constant/macroAgent';
import { getDisplayName, getDisplayNameParts, tryMacroId } from '@core/user';
import { useBotQuery } from '@queries/bots/bots';
import { firstPartyBotName } from '@queries/bots/first-party-bot-name';
import { queryReadyGate } from '@queries/gate';
import type { Accessor } from 'solid-js';

/** Resolve user-property principals without treating bot IDs as email users. */
export function usePropertyUserDisplay(id: Accessor<string>) {
  const isAgent = () => isBotPrincipalId(id());
  const botId = () => id().replace(/^bot\|/, '');
  const bot = useBotQuery(botId, isAgent);
  // Every data read is gated so property pills and hover cards never suspend
  // their surrounding task while resolving an agent's profile.
  const profile = () =>
    isAgent() && queryReadyGate(bot) ? bot.data : undefined;
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
    photoUrl: () => profile()?.avatar_url ?? undefined,
  };
}
