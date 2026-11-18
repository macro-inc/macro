/**
 * Shows the agent typing while it works on a reply, until the reply posts:
 * one indicator per channel, replaced by the next reply's. Indicators come
 * from muppet's `typingIndicators`, shared with anything else that types in
 * the agent's process (its greeting), so stopping a reply's never ends
 * another's.
 */
import type { TypingIndicators } from '@macro-inc/muppet/utilities/macro/chat';

export type Typing = {
  /** Shows the agent typing in the channel, in a thread if `root` is given, until stopped. */
  readonly start: (channelId: string, root?: string) => void;
  /** Stops it. Resolves once it is stopped, at once if it wasn't typing there. */
  readonly stop: (channelId: string) => Promise<void>;
};

export const typing = (indicators: TypingIndicators): Typing => {
  const stops = new Map<string, () => Promise<void>>();
  const stop = (channelId: string): Promise<void> => {
    const own = stops.get(channelId);
    stops.delete(channelId);
    return own?.() ?? Promise.resolve();
  };
  return {
    stop,
    start: (channelId, root) => {
      void stop(channelId);
      stops.set(channelId, indicators.start(channelId, root));
    },
  };
};
