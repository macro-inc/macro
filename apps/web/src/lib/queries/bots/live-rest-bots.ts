import type { Accessor } from 'solid-js';
import { createBotIdentities } from './graphql-bots';

/** The identity fields a REST bot (or an agent's bot) carries. */
type RestBotIdentity = {
  id: string;
  name: string;
  handle: string;
  avatar_url?: string | null;
};

/**
 * `bots` with each bot's name, handle and picture as they are now. A REST
 * list decides which bots belong (channel membership, agent config); their
 * identity comes from the `GraphqlBot` records every view shares, so a
 * rename shows without refetching the list. A bot whose identity has not
 * been read yet keeps the copy the list returned.
 */
export function useLiveRestBots<Bot extends RestBotIdentity>(
  bots: Accessor<readonly Bot[]>
): Accessor<Bot[]> {
  const identity = createBotIdentities(() => bots().map((bot) => bot.id));
  return () =>
    bots().map((bot) => {
      const current = identity(bot.id);
      if (!current) return bot;
      return {
        ...bot,
        name: current.name,
        handle: current.handle || bot.handle,
        avatar_url: current.avatarUrl ?? null,
      };
    });
}
