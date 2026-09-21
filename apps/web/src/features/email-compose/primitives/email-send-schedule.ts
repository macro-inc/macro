import { format } from 'date-fns/format';
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
  reconcile?: () => Promise<unknown>;
}) {
  const { delivery, notices } = options;
  const [pending, setPending] = createSignal(false);

  const change = async (date: Date | null): Promise<boolean> => {
    if (pending()) return false;
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
          return false;
        }
        options.setSendTime(null);
        notices.feedback.success('Email unscheduled');
        return true;
      }
      if (!date) {
        options.setSendTime(null);
        return true;
      }
      // Persistence owns its failure notice; a failed save is not a failed schedule request.
      let draftId: string | undefined;
      try {
        draftId = await options.saveDraft();
      } catch {
        return false;
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
        return false;
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
      notices.feedback.success(
        `${previous ? 'Email rescheduled' : 'Email scheduled'} for ${format(date, "MMM d, yyyy 'at' h:mm a")}`
      );
      return true;
    } catch (error) {
      // Presentation failures do not change a successful schedule/unschedule.
      notices.reportError(error);
      return false;
    } finally {
      try {
        await options.reconcile?.();
      } catch (error) {
        notices.reportError(error);
      }
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
