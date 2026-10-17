import { type Span, Telemetry } from '@macro-inc/observability';
import type { Accessor } from 'solid-js';
import type { ReplyType } from '../core/reply-type';

/** Where a reply can move: from its thread into the app's reply window, or back. */
export interface ReplyMoveTarget {
  /** This composer is the one in the window. */
  inWindow: boolean;
  /** Runs once the draft is saved: the other side opens it from there. */
  move: (replyType: ReplyType) => void;
}

/**
 * Moves a reply between its thread and the app's reply window. The other
 * editor opens the reply from its saved draft, so this saves first; a reply
 * that can't be saved stays put with the failure shown. A request made while
 * one is still saving is ignored, so a double press moves the reply once.
 */
export function createReplyMove(options: {
  target: Accessor<ReplyMoveTarget | undefined>;
  isSending: Accessor<boolean>;
  /** The reply has content worth saving before it moves. */
  hasContent: () => boolean;
  saveDraft: () => Promise<unknown>;
  reportError: (error: unknown) => void;
  replyType: Accessor<ReplyType>;
  threadId: Accessor<string | undefined>;
  draftId: Accessor<string | undefined>;
}): () => Promise<void> {
  let moving = false;
  const saveAndMove = async (target: ReplyMoveTarget, span: Span) => {
    span.setAttr('email.thread_id', options.threadId() ?? '');
    span.setAttr('email.reply.to_window', !target.inWindow);
    if (options.hasContent()) {
      try {
        await options.saveDraft();
      } catch (error) {
        span.error(error);
        options.reportError(error);
        return;
      }
    }
    span.setAttr('email.draft_id', options.draftId() ?? '');
    target.move(options.replyType());
  };
  return async () => {
    const target = options.target();
    if (!target || moving || options.isSending()) return;
    moving = true;
    try {
      await Telemetry.span('email.reply.move', (span) =>
        saveAndMove(target, span)
      );
    } finally {
      moving = false;
    }
  };
}
