import { type Accessor, createEffect, createSignal, on } from 'solid-js';
import type {
  EmailComposeFeedback,
  EmailDelivery,
} from '../context/compose-services';

type ScheduleServices = Pick<
  EmailDelivery,
  'schedule' | 'unschedule' | 'archive'
> &
  EmailComposeFeedback;

export function createEmailSendSchedule(options: {
  services: ScheduleServices;
  draftId: Accessor<string | null | undefined>;
  saveDraft: () => Promise<string | undefined>;
  threadId: Accessor<string | null | undefined>;
  linkId: Accessor<string | undefined>;
  sendTime: Accessor<Date | null | undefined>;
  setSendTime: (date: Date | null) => void;
  recipientCount: Accessor<number>;
}) {
  const { services } = options;
  const [pending, setPending] = createSignal(false);

  const change = async (date: Date | null) => {
    if (pending()) return;
    const linkId = options.linkId();
    setPending(true);
    try {
      const previous = options.sendTime();
      const currentDraft = options.draftId();
      if (!date && previous && currentDraft) {
        try {
          await services.unschedule({
            draftID: currentDraft,
            linkId,
          });
        } catch (error) {
          services.reportError(error);
          services.feedback.failure('Failed to unschedule email');
          return;
        }
        options.setSendTime(null);
        services.feedback.success('Email unscheduled');
        return;
      }
      if (!date) {
        options.setSendTime(null);
        return;
      }
      // Persistence owns its failure notice; a failed save is not a failed schedule request.
      let draftID: string | undefined;
      try {
        draftID = await options.saveDraft();
      } catch (error) {
        services.reportError(error);
        return;
      }
      try {
        if (!draftID) throw new Error('Draft required');
        await services.schedule(
          { draftID, send_time: date.toISOString() },
          linkId
        );
      } catch (error) {
        services.reportError(error);
        services.feedback.failure('Failed to schedule message');
        return;
      }
      options.setSendTime(date);
      const threadID = options.threadId();
      if (threadID) {
        try {
          await services.archive({ id: threadID, value: true }, linkId);
        } catch (error) {
          services.reportError(error);
          services.feedback.failure(
            'Email scheduled, but unable to mark thread done'
          );
        }
      }
    } catch (error) {
      // Presentation failures do not change a successful schedule/unschedule.
      services.reportError(error);
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
