import { type Accessor, createEffect, createSignal, on } from 'solid-js';
import type {
  EmailComposeFeedback,
  EmailDelivery,
} from '../context/compose-capabilities';

export function createEmailSendSchedule(options: {
  delivery: Pick<EmailDelivery, 'schedule' | 'unschedule' | 'archive'>;
  notices: EmailComposeFeedback;
  draftId: Accessor<string | null | undefined>;
  saveDraft: () => Promise<string | undefined>;
  threadId: Accessor<string | null | undefined>;
  inboxId: Accessor<string | undefined>;
  sendTime: Accessor<Date | null | undefined>;
  setSendTime: (date: Date | null) => void;
  recipientCount: Accessor<number>;
}) {
  const { delivery, notices } = options;
  const [pending, setPending] = createSignal(false);

  const change = async (date: Date | null) => {
    if (pending()) return;
    const inboxId = options.inboxId();
    setPending(true);
    try {
      const previous = options.sendTime();
      const currentDraft = options.draftId();
      if (!date && previous && currentDraft) {
        try {
          await delivery.unschedule({
            draftId: currentDraft,
            inboxId,
          });
        } catch (error) {
          notices.reportError(error);
          notices.feedback.failure('Failed to unschedule email');
          return;
        }
        options.setSendTime(null);
        notices.feedback.success('Email unscheduled');
        return;
      }
      if (!date) {
        options.setSendTime(null);
        return;
      }
      // Persistence owns its failure notice; a failed save is not a failed schedule request.
      let draftId: string | undefined;
      try {
        draftId = await options.saveDraft();
      } catch (error) {
        notices.reportError(error);
        return;
      }
      try {
        if (!draftId) throw new Error('Draft required');
        await delivery.schedule(
          { draftId, sendTime: date.toISOString() },
          inboxId
        );
      } catch (error) {
        notices.reportError(error);
        notices.feedback.failure('Failed to schedule message');
        return;
      }
      options.setSendTime(date);
      const threadId = options.threadId();
      if (threadId) {
        try {
          await delivery.archive({ threadId, value: true }, inboxId);
        } catch (error) {
          notices.reportError(error);
          notices.feedback.failure(
            'Email scheduled, but unable to mark thread done'
          );
        }
      }
    } catch (error) {
      // Presentation failures do not change a successful schedule/unschedule.
      notices.reportError(error);
    } finally {
      setPending(false);
    }
  };

  createEffect(
    on(
      options.recipientCount,
      (count) => {
        if (count === 0 && options.sendTime()) void change(null);
      },
      { defer: true }
    )
  );
  return { pending, change };
}
