import { type Accessor, createEffect, createMemo } from 'solid-js';
import type { EmailMessage } from '../../email-message/core/email-message';

/** Owns bottom/drawer reply placement independently of thread navigation. */
export function createThreadReplyArea(options: {
  threadId: Accessor<string>;
  isTouch: Accessor<boolean>;
  messages: Accessor<EmailMessage[]>;
  allMessages: Accessor<EmailMessage[]>;
  canCompose: Accessor<boolean>;
  drafts: {
    getDraftForMessage(id: string): EmailMessage | undefined;
    initialDraftsSettled: Accessor<boolean>;
  };
  bottomReply: { open: Accessor<boolean>; setOpen(open: boolean): void };
  mobileReply: {
    open: Accessor<boolean>;
    openForMessage(id: string): void;
    close(): void;
  };
}) {
  // On thread change: collapse the bottom reply, then re-evaluate auto-open
  // for the current thread's last message. Single effect to avoid an
  // ordering race between separate "reset on thread change" and "auto-open
  // on draft" effects (Solid runs effects in declaration order on first
  // mount, which can let the reset clobber the auto-open if both data
  // sources are synchronously available).
  let prevThreadId: string | undefined;
  createEffect(() => {
    const tid = options.threadId();
    if (prevThreadId !== tid) {
      prevThreadId = tid;
      options.bottomReply.setOpen(false);
      options.mobileReply.close();
    }
    const filtered = options.messages();
    const lastMessage = filtered.at(-1);
    if (!lastMessage?.db_id) return;
    if (options.drafts.getDraftForMessage(lastMessage.db_id)) {
      if (options.isTouch()) {
        options.mobileReply.openForMessage(lastMessage.db_id);
      } else {
        options.bottomReply.setOpen(true);
      }
    }
  });

  const emailReplyInfo = createMemo(() => {
    const filtered = options.messages();

    // If there are non draft messages in this thread, the bottom input will
    // be for sending a reply to the last message
    if (filtered.length !== 0) {
      const lastMessage = filtered.at(-1);
      if (!lastMessage || !lastMessage.db_id) return;
      return {
        replyingTo: lastMessage,
        draft: options.drafts.getDraftForMessage(lastMessage.db_id),
      };
    }

    // Otherwise, if the other messages in the thread are drafts,
    // the bottom input will be for editing and sending the latest/last draft
    const unfiltered = options.allMessages();

    if (unfiltered.length === 0) return;

    const latest = unfiltered.at(-1);

    if (!latest || !latest.is_draft) return;

    return { replyingTo: undefined, draft: latest };
  });

  // The bottom reply area renders when the user can compose and there's a
  // message to reply to or a draft to edit. Returns the reply info so it can
  // drive the keyed <Show> around the reply area.
  const replyArea = () => {
    if (!options.canCompose()) return;
    if (!options.drafts.initialDraftsSettled()) return;
    return emailReplyInfo();
  };

  // The expanded compose input, as opposed to the collapsed reply buttons
  // (which float in the mobile accessory region).
  const replyInputOpen = () =>
    options.bottomReply.open() || emailReplyInfo()?.replyingTo == null;

  // Whether the compose input is rendered in normal flow.
  const replyInputInFlow = () => Boolean(replyArea() && replyInputOpen());

  const mobileBottomReplyMessage = createMemo(() => {
    if (options.mobileReply.open()) return;
    return replyArea()?.replyingTo;
  });

  return {
    info: emailReplyInfo,
    inFlow: replyInputInFlow,
    mobileMessage: mobileBottomReplyMessage,
  };
}
