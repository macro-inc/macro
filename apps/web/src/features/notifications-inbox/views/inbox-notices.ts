import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowCounterClockwise from '@icon/system/regular/arrow-counter-clockwise.svg';
import { match } from 'ts-pattern';
import type { InboxDecision } from '../core/inbox-row';

/** Toasts for what the inbox did: done and cleared rows, with Undo. */
export const INBOX_ANNOUNCEMENTS = {
  announceDone: (count: number, undo: () => Promise<void>) => {
    const id = toast.success(t('notificationsInbox.markedDone', { count }), {
      dismissStyle: 'icon',
      actionLayout: 'inline',
      actions: [
        {
          label: t('notificationsInbox.undo'),
          icon: ArrowCounterClockwise,
          onClick: () => fireAndForget(undo(), 'notifications-inbox'),
        },
      ],
      duration: 3_000,
      stack: true,
      hideOnMobile: true,
    });
    return () => {
      if (id !== undefined) toast.dismiss(id);
    };
  },
  announceCleared: (
    count: number,
    undo: () => Promise<void>,
    complete = true
  ) => {
    const id =
      count === 0 && complete
        ? toast.success(t('notificationsInbox.clearedNothing'))
        : toast.success(
            complete
              ? t('notificationsInbox.cleared', { count })
              : t('notificationsInbox.stillClearing', { count }),
            {
              dismissStyle: 'icon',
              actionLayout: 'inline',
              actions: [
                {
                  label: t('notificationsInbox.undo'),
                  icon: ArrowCounterClockwise,
                  onClick: () => fireAndForget(undo(), 'notifications-inbox'),
                },
              ],
              duration: 8_000,
              stack: true,
            }
          );
    return () => {
      if (id !== undefined) toast.dismiss(id);
    };
  },
  announceFailure: (message: string) => toast.failure(message),
};

export const decisionOutcome = (decision: InboxDecision) =>
  match(decision)
    .with('approve', () => t('notificationsInbox.accessGranted'))
    .with('deny', () => t('notificationsInbox.accessDenied'))
    .with('accept', () => t('notificationsInbox.joinAccepted'))
    .with('decline', () => t('notificationsInbox.joinDeclined'))
    .exhaustive();

export const decisionFailure = (decision: InboxDecision) =>
  match(decision)
    .with('approve', 'deny', () => t('notificationsInbox.accessAnswerFailed'))
    .with('accept', 'decline', () => t('notificationsInbox.joinAnswerFailed'))
    .exhaustive();
