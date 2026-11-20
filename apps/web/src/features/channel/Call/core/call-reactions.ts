export const CALL_REACTION_EMOJIS = ['👍', '👏', '😂', '❤️', '🎉'] as const;
export type CallReactionEmoji = (typeof CALL_REACTION_EMOJIS)[number];
export type CallReaction = {
  id: number;
  sender: string;
  emoji: CallReactionEmoji;
};
export const CALL_REACTION_TOPIC = 'macro.call.reaction.v1';
export const CALL_REACTION_LIFETIME_MS = 3200;

export function decodeCallReaction(
  payload: Uint8Array
): CallReactionEmoji | undefined {
  if (payload.byteLength > 256) return undefined;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(payload));
    if (!value || typeof value !== 'object') return undefined;
    if (!('version' in value) || value.version !== 1) return undefined;
    if (!('emoji' in value)) return undefined;
    return CALL_REACTION_EMOJIS.find((emoji) => emoji === value.emoji);
  } catch {
    return undefined;
  }
}
