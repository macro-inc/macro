import { type MacroId, tryMacroId } from '@core/user/macroId';
import { isHexHyphenatedId } from '@queries/bots/bot-id';
import { firstPartyBotName } from '@queries/bots/first-party-bot-name';

export type Owner =
  | { kind: 'user'; id: MacroId }
  | { kind: 'bot'; botId: string }
  | { kind: 'team'; teamId: string }
  | { kind: 'unknown'; raw: string };

const BOT_PREFIX = 'bot|';

export function parseOwner(principal: string | undefined): Owner | undefined {
  if (!principal) return undefined;
  const user = tryMacroId(principal);
  if (user) return { kind: 'user', id: user };
  if (principal.startsWith(BOT_PREFIX)) {
    const botId = principal.slice(BOT_PREFIX.length);
    return isHexHyphenatedId(botId)
      ? { kind: 'bot', botId }
      : { kind: 'unknown', raw: principal };
  }
  const bareFirstPartyBot = firstPartyBotName(principal);
  if (bareFirstPartyBot) return { kind: 'bot', botId: principal };
  if (isHexHyphenatedId(principal)) return { kind: 'team', teamId: principal };
  return { kind: 'unknown', raw: principal };
}

export function botOwnerName(profile: {
  name: string;
  deleted: boolean;
}): string {
  return profile.deleted ? `${profile.name} (deleted)` : profile.name;
}
