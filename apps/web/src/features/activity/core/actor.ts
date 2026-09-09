import { type MacroId, tryMacroId } from '@core/user/macroId';

/**
 * Who performed an activity event, parsed once from the wire `actorId`.
 * The backend emits `macro|<email>` for users and `bot|<uuid>` for bots
 * (first-party agents, team bots, and the system principal). Anything else
 * is preserved raw so the row can still say something honest.
 */
export type Actor =
  | { kind: 'user'; id: MacroId }
  | { kind: 'bot'; botId: string }
  | { kind: 'unknown'; raw: string };

const BOT_PREFIX = 'bot|';

export function parseActor(actorId: string): Actor {
  const user = tryMacroId(actorId);
  if (user) return { kind: 'user', id: user };
  if (actorId.startsWith(BOT_PREFIX)) {
    const botId = actorId.slice(BOT_PREFIX.length);
    if (botId.length > 0) return { kind: 'bot', botId };
  }
  return { kind: 'unknown', raw: actorId };
}
