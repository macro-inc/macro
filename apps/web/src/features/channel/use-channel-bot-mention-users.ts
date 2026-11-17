import { isCursorBotId } from '@core/constant/cursorAgent';
import { useCursorAgentsAccess } from '@core/cursor/flag';
import type { IUser } from '@core/user/types';
import { useOfflineAgentBotIds } from '@queries/agents/offline-runtimes';
import {
  type BotIdentity,
  createMentionableBots,
} from '@queries/bots/graphql-bots';
import type { MessageParent } from '@service-storage/messages';
import { type Accessor, createMemo } from 'solid-js';

function mentionUser(bot: BotIdentity, offline: boolean): IUser {
  return {
    id: `bot|${bot.id}`,
    name: bot.name,
    email: bot.name,
    photoUrl: bot.avatarUrl,
    offline: offline || undefined,
  };
}

/**
 * Mention entries for the bots the viewer can mention. Which bots that is
 * (a channel's installed bots, then agents available in every channel;
 * elsewhere every agent the viewer can start) is the server's
 * `mentionableBots`. Account setup does not hide a mention: the harness
 * answers with a connection prompt in the thread when setup is needed. The
 * built-in Cursor entry follows the Cursor rollout flag.
 *
 * A disconnected macrod runtime is different from unfinished setup, and is
 * marked: no harness is listening, so the mention would go unanswered rather
 * than prompt for anything.
 */
export function botMentionUsers(
  bots: readonly BotIdentity[],
  cursorEnabled: boolean,
  offlineBotIds: ReadonlySet<string> = new Set()
): IUser[] {
  return bots
    .filter((bot) => cursorEnabled || !isCursorBotId(bot.id))
    .map((bot) => mentionUser(bot, offlineBotIds.has(bot.id)));
}

/** `mentionableBots` scope for a message surface: a channel, or everywhere. */
export function mentionScope(parent: MessageParent): string | null {
  return parent.type === 'channel' ? parent.id : null;
}

/**
 * The bots a message on `parent` can mention, as synthetic [`IUser`] entries
 * for the `@`-mention typeahead. Like `macroAiMentionUser()`, `email` is set
 * to the bot's name so persisted mentions render as "@BotName", and `id` uses
 * the canonical `bot|<uuid>` principal form so mentions are re-tagged as bot
 * mentions at send time (see `authoredMentions`).
 *
 * `load` defers the list and runtime status off channels, for a composer
 * mounted on every record and document but written in on few of them.
 */
export function useMessageBotMentionUsers(
  parent: Accessor<MessageParent>,
  load: Accessor<boolean> = () => true
): Accessor<IUser[]> {
  const mentionable = createMentionableBots(() =>
    parent().type === 'channel' || load() ? mentionScope(parent()) : undefined
  );
  const canUseCursor = useCursorAgentsAccess();
  const offlineBotIds = useOfflineAgentBotIds(load);

  return createMemo(() =>
    botMentionUsers(mentionable.bots(), canUseCursor(), offlineBotIds())
  );
}
