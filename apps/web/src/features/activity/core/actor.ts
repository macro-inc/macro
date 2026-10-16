import { type MacroId, tryMacroId } from '@core/user/macroId';
import { NIL as NIL_UUID, validate as validateUuid } from 'uuid';

/**
 * Who performed an activity event, parsed once from the wire `actorId`.
 * The backend emits `macro|<email>` for users, `bot|<uuid>` for bots,
 * and `external|<uuid>` for account-scoped external attribution. Anything
 * else is preserved raw so the row can still say something honest.
 */
export type Actor =
  | { kind: 'user'; id: MacroId }
  | { kind: 'bot'; botId: string }
  | { kind: 'external' }
  | { kind: 'unknown'; raw: string };

const BOT_PREFIX = 'bot|';
const EXTERNAL_PREFIX = 'external|';

export function parseActor(actorId: string): Actor {
  const user = tryMacroId(actorId);
  if (user) return { kind: 'user', id: user };
  if (actorId.startsWith(BOT_PREFIX)) {
    const botId = actorId.slice(BOT_PREFIX.length);
    if (botId.length > 0) return { kind: 'bot', botId };
  }
  if (actorId.startsWith(EXTERNAL_PREFIX)) {
    const id = actorId.slice(EXTERNAL_PREFIX.length);
    if (id !== NIL_UUID && id === id.toLowerCase() && validateUuid(id)) {
      return { kind: 'external' };
    }
  }
  return { kind: 'unknown', raw: actorId };
}
