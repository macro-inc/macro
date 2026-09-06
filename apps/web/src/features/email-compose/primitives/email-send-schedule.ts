import { type Accessor, createEffect, createSignal, on } from 'solid-js';
import type { EmailComposeServices } from '../context/compose-services';
import { createComposeOperation } from './compose-operation';

type ScheduleServices = Pick<
  EmailComposeServices,
  'schedule' | 'unschedule' | 'archive' | 'feedback' | 'reportError'
>;

export function createEmailSendSchedule(options: {
  services: ScheduleServices;
  draftId: Accessor<string | null | undefined>;
  saveDraft: () => Promise<string | undefined>;
  threadId: Accessor<string | null | undefined>;
  linkId: Accessor<string | undefined>;
  sendTime: Accessor<Date | null | undefined>;
  setSendTime: (date: Date | null) => void;
  recipientCount: Accessor<number>;
  onUnscheduled?: (draftId: string) => void;
}) {
  const { services } = options;
  const [pending, setPending] = createSignal(false);
  const unschedule = createComposeOperation(services.unschedule, {
    onSuccess: (_data, vars) => {
      services.feedback.success('Email unscheduled');
      options.onUnscheduled?.(vars.draftID);
    },
    onError: () => services.feedback.failure('Failed to unschedule email'),
  });

  const change = async (date: Date | null) => {
    if (pending()) return;
    setPending(true);
    try {
      const previous = options.sendTime();
      const currentDraft = options.draftId();
      if (!date && previous && currentDraft) {
        try {
          await unschedule.run({
            draftID: currentDraft,
            linkId: options.linkId(),
          });
          options.setSendTime(null);
        } catch {
          // The operation reports failure; retain the confirmed send time.
        }
        return;
      }
      if (!date) {
        options.setSendTime(null);
        return;
      }
      try {
        const draftID = currentDraft ?? (await options.saveDraft());
        if (!draftID) throw new Error('Draft required');
        await services.schedule(
          { draftID, send_time: date.toISOString() },
          options.linkId()
        );
        options.setSendTime(date);
      } catch (error) {
        services.reportError(error);
        services.feedback.failure('Failed to schedule message');
        return;
      }
      const threadID = options.threadId();
      if (threadID) {
        try {
          await services.archive(
            { id: threadID, value: true },
            options.linkId()
          );
        } catch (error) {
          services.reportError(error);
          services.feedback.failure(
            'Email scheduled, but unable to mark thread done'
          );
        }
      }
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
