import {
  isBotPrincipalId,
  MACRO_AGENT_BOT_ID,
} from '@core/constant/macroAgent';
import { isAiPeer } from '@macro-inc/collaboration/collab/ai-peer';
import { usePropertyUserDisplay } from '@property/hooks/usePropertyUserDisplay';
import type { Accessor } from 'solid-js';
import { AI_AUTHOR_PREFIX, aiAuthorOnBehalfOf, userLabel } from './utils';

/** What the sync service recorded for a peer: whose token registered it, and
 *  the signed agent actor (`bot|<uuid>`) it edited as, if any. */
export type PeerRecord = { userId: string; actor: string | null };

/**
 * Who a peer's edits are attributed to. A peer an agent registered resolves to
 * the agent (`bot|<uuid>`); any other AI peer to `ai|<userId>`, the user it
 * edited for; a human peer to its user. An AI peer with no record (registered
 * anonymously) falls back to Macro.
 */
export function peerAuthorId(
  peer: string,
  record: PeerRecord | undefined
): string {
  if (record?.actor) return record.actor;
  if (isAiPeer(BigInt(peer))) {
    return record ? `${AI_AUTHOR_PREFIX}${record.userId}` : MACRO_AGENT_BOT_ID;
  }
  return record?.userId ?? 'unknown';
}

/** The principal an author's avatar shows: the user behind an `ai|` author. */
export function authorPrincipalId(authorId: string): string {
  return aiAuthorOnBehalfOf(authorId) ?? authorId;
}

/**
 * Display name for an author id from `peerAuthorId`: the agent's name, `<user>
 * (AI)` for AI edits made for a user, or `userName` for a human. `userName` may
 * return '' while names load; the id's plain label stands in.
 */
export function useAuthorName(
  authorId: Accessor<string>,
  userName: (userId: string) => string
): Accessor<string> {
  const principal = () => authorPrincipalId(authorId());
  const bot = usePropertyUserDisplay(principal);
  const humanName = (userId: string) => userName(userId) || userLabel(userId);
  return () => {
    const id = authorId();
    const onBehalfOf = aiAuthorOnBehalfOf(id);
    if (onBehalfOf !== undefined) return `${humanName(onBehalfOf)} (AI)`;
    if (isBotPrincipalId(id)) return bot.name();
    return humanName(id);
  };
}
