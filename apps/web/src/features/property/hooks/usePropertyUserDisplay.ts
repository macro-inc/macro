import { isBotPrincipalId } from '@core/constant/macroAgent';
import { getDisplayName, getDisplayNameParts, tryMacroId } from '@core/user';
import { firstPartyBotName } from '@queries/bots/first-party-bot-name';
import { createBotIdentity } from '@queries/bots/graphql-bots';
import type { Accessor } from 'solid-js';

/** Resolve user-property principals without treating bot IDs as email users. */
export function usePropertyUserDisplay(id: Accessor<string>) {
  const isAgent = () => isBotPrincipalId(id());
  const botId = () => (isAgent() ? id().replace(/^bot\|/, '') : '');
  // Reads nothing for a person: the id is empty.
  const bot = createBotIdentity(botId);
  const profile = () => bot.data() ?? undefined;
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
