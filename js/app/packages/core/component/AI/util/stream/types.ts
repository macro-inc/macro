import type { ChatStream } from '@service-cognition/generated/schemas';
import type { ChatMessageStream } from '@service-connection/stream';
import type { Accessor } from 'solid-js';
export type StreamItem = ReturnType<ChatMessageStream['data']>[number];
export type NetworkDelay = (index: number) => number;
export type Splitter = (items: StreamItem[]) => StreamItem[];

export type BufferedChatMessageStream = ChatMessageStream & {
  /* True while a stream plugin is holding output back for more input. */
  isHolding: Accessor<boolean>;
};

/**
 * Rewrites the units a buffered stream emits, sitting between the buffering
 * consumers and the output controller. A plugin may hold units back (return
 * fewer than it was given) and release them later — the buffered stream
 * flushes every plugin when the source finishes, and force-flushes if the
 * source goes quiet while a plugin is holding, so held content is never
 * stuck invisibly.
 */
export interface StreamPlugin {
  /* Process one outgoing unit; returns the units ready to emit now (empty while holding). */
  transform(part: ChatStream): ChatStream[];
  /* Release everything held, as close to the original units as possible. */
  flush(): ChatStream[];
  /* True while output is held back waiting on more input. */
  isHolding(): boolean;
}
