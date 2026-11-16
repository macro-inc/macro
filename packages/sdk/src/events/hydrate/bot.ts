import { Bot } from '../../entities/bots/bot';
import type { MacroClient } from '../../utils/client';
import type { MacroEvent } from '../types';

export type BotEvent = Extract<MacroEvent, { event_type: `bot.${string}` }>;

/** Attach the bot handle to a bot lifecycle event. */
export function hydrateBotEvent(client: MacroClient, event: BotEvent) {
  return {
    event_type: event.event_type,
    metadata: event.metadata,
    bot: Bot.byId(client, event.metadata.bot_id),
  };
}
