import type { MessageSender } from '@service-storage/messages';
import { isHexHyphenatedId } from './bot-id';
import { firstPartyBotName } from './first-party-bot-name';
import { createBotIdentity } from './graphql-bots';

/**
 * `sender` with a team bot's name and picture as they are now. The copy the
 * message arrived with shows until the bot's identity is read; after that a
 * rename or new picture replaces it on every message by the bot. First-party
 * bots and posts made through a client keep their own identity.
 */
export function useLiveBotSender(
  sender: () => MessageSender
): () => MessageSender {
  const botId = () => {
    const current = sender();
    const isTeamBot =
      current.type === 'bot' &&
      !current.triggered_via &&
      !firstPartyBotName(current.id) &&
      isHexHyphenatedId(current.id);
    return isTeamBot ? current.id : '';
  };
  const identity = createBotIdentity(botId);

  return () => {
    const current = sender();
    const bot = botId() ? identity.data() : undefined;
    if (!bot) return current;
    return { ...current, name: bot.name, avatar_url: bot.avatarUrl ?? null };
  };
}
