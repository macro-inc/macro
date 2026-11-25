import { isAgentAccount, tryMacroId } from '@core/user';
import type {
  MessageListItem,
  MessageTimelineEntry,
} from '@service-storage/messages';

/** The teammate at the other end of a 1:1 conversation the viewer is in. */
export function directMessageTeammate(
  viewerId: string | undefined,
  participants: readonly string[]
) {
  if (
    !viewerId ||
    participants.length !== 2 ||
    !participants.includes(viewerId)
  )
    return undefined;

  const other = participants.find((id) => id !== viewerId);
  if (other && isAgentAccount(tryMacroId(other))) return other;
}

type GreetingTimelineEntry =
  | { type: 'message'; message: Pick<MessageListItem, 'id' | 'sender_id'> }
  | { type: Exclude<MessageTimelineEntry['type'], 'message'> };

/** Once the oldest page is loaded, select the first teammate-authored message. */
export function firstTeammateMessage(
  entries: readonly GreetingTimelineEntry[],
  teammateId: string,
  reachedStart: boolean
) {
  if (!reachedStart) return undefined;
  for (const entry of entries) {
    if (entry.type === 'message' && entry.message.sender_id === teammateId)
      return entry.message.id;
  }
}
