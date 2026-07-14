import { createSignal } from 'solid-js';
import type { MessageData } from '../Message';

/** The unified input's reply binding, persisted by ids only. */
export type UnifiedReplyTargetSnapshot = {
  threadId: string;
  replyId?: string;
};

/**
 * The unified input's reply binding: a message pointer shaped like every
 * other one in channels — the thread root plus an optional reply (set for
 * quote-replies). `message` is the bound message itself; it is absent when
 * the binding was restored from a history snapshot (a reply's MessageData is
 * not resolvable at restore time).
 */
export type UnifiedReplyTarget = UnifiedReplyTargetSnapshot & {
  message?: MessageData;
};

/**
 * The unified input's reply binding — at most one, channel-wide.
 */
export function createUnifiedInputManager(options?: {
  /** Binding restored from a history snapshot. */
  initialReplyTarget?: UnifiedReplyTargetSnapshot;
  /**
   * Called when a thread stops being the reply target — the reply closed, or
   * the binding moved to another thread — so the caller can clear anything
   * still pointing at it (e.g. a highlight set by the reply flag's navigate
   * action).
   */
  onReplyThreadReleased?: (threadId: string) => void;
}) {
  const [replyTarget, setReplyTarget] = createSignal<
    UnifiedReplyTarget | undefined
  >(options?.initialReplyTarget);

  const bindReply = (message: MessageData) => {
    const previous = replyTarget();
    const threadId = message.thread_id ?? message.id;
    if (previous && previous.threadId !== threadId) {
      options?.onReplyThreadReleased?.(previous.threadId);
    }
    setReplyTarget({
      threadId,
      replyId: message.thread_id ? message.id : undefined,
      message,
    });
  };

  const closeReply = () => {
    const target = replyTarget();
    if (!target) return;
    setReplyTarget(undefined);
    options?.onReplyThreadReleased?.(target.threadId);
  };

  /** The binding for a history snapshot — ids only */
  const getReplyTargetSnapshot = (): UnifiedReplyTargetSnapshot | undefined => {
    const target = replyTarget();
    return target
      ? { threadId: target.threadId, replyId: target.replyId }
      : undefined;
  };

  return {
    replyTarget,
    bindReply,
    closeReply,
    getReplyTargetSnapshot,
  };
}
