import { formatLocale, t } from '@app/lib/i18n';
import { Button, EmptyStatePanel } from '@ui';
import { isValid } from 'date-fns';
import { createUniqueId, For, Show } from 'solid-js';
import type {
  AttentionReason,
  DeliveryIssue,
  Enrollment,
  MarketingContact,
  QueuedStep,
} from '../core/model';
import { enrollmentErrorMessage } from './error-message';
import { AttentionBadge, attentionDetail, StatusBadge } from './status-badge';

const STEP_STATUS = {
  pending: 'emailMarketing.stepPending',
  scheduling: 'emailMarketing.stepScheduling',
  queued: 'emailMarketing.stepScheduled',
  canceled: 'emailMarketing.stepCanceled',
  delivery_started: 'emailMarketing.stepSent',
} as const satisfies Record<QueuedStep['status'], string>;

/** Pausing also rescues a failed or interrupted enrollment: resume finishes it. */
const PAUSABLE: Enrollment['status'][] = [
  'scheduled',
  'preparing',
  'needs_attention',
];

function stepState(step: QueuedStep, sent: boolean) {
  if (sent) return t(STEP_STATUS.delivery_started);
  if (step.status === 'queued' && new Date(step.sendAt).getTime() <= Date.now())
    return t('emailMarketing.stepDue');
  return t(STEP_STATUS[step.status]);
}

export function EnrollmentList(props: {
  entries: Enrollment[];
  campaignActive: boolean;
  disabled: boolean;
  isUnsubscribed: (email: string) => boolean;
  attention: (entry: Enrollment) => AttentionReason | undefined;
  /** A scheduled enrollment with nothing left to send. */
  isFinished: (entry: Enrollment) => boolean;
  stepIssue: (step: QueuedStep) => DeliveryIssue | undefined;
  stepSent: (step: QueuedStep) => boolean;
  onPause: (entry: Enrollment) => void;
  onResume: (entry: Enrollment) => void;
  onStop: (entry: Enrollment) => void;
  onUnsubscribe: (contact: MarketingContact) => void;
  onOpenContact: (contact: MarketingContact) => void;
  onOpenThread: (threadId: string) => void;
}) {
  const time = () =>
    new Intl.DateTimeFormat(formatLocale(), {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  /** A record edited in the database can hold any text as a send time. */
  const stepTiming = (step: QueuedStep) => {
    const sendAt = new Date(step.sendAt);
    if (
      step.status === 'canceled' ||
      step.status === 'delivery_started' ||
      !isValid(sendAt)
    )
      return stepState(step, props.stepSent(step));
    return t('emailMarketing.stepAt', {
      time: time().format(sendAt),
      state: stepState(step, props.stepSent(step)),
    });
  };
  return (
    <div class="mx-auto w-full max-w-3xl space-y-4">
      <div>
        <h3 class="text-base font-medium">
          {t('emailMarketing.peopleInSequence')}
        </h3>
        <p class="mt-1 text-xs text-ink-muted">
          {t('emailMarketing.peopleInSequenceHint')}
        </p>
      </div>
      <Show
        when={props.entries.length}
        fallback={
          <EmptyStatePanel
            centered
            class="h-auto py-10"
            title={t('emailMarketing.noEnrollments')}
          />
        }
      >
        <For each={props.entries}>
          {(entry) => {
            // Named by the masked heading, not an attribute replay would record.
            const nameId = createUniqueId();
            return (
              <article
                class="rounded-xl border border-edge-muted p-4"
                aria-labelledby={nameId}
              >
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div class="ph-no-capture min-w-0">
                    <Button
                      id={nameId}
                      type="button"
                      variant="link"
                      size="sm"
                      class="max-w-full truncate px-0 text-ink"
                      onClick={() => props.onOpenContact(entry.contact)}
                    >
                      {entry.contact.name || entry.contact.email}
                    </Button>
                    <p class="mt-1 truncate text-xs text-ink-muted">
                      {entry.contact.email}
                    </p>
                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    <Show
                      when={props.attention(entry)}
                      fallback={
                        <StatusBadge
                          status={
                            props.isFinished(entry) ? 'completed' : entry.status
                          }
                        />
                      }
                    >
                      {(reason) => <AttentionBadge reason={reason()} />}
                    </Show>
                    <Show when={props.isUnsubscribed(entry.contact.email)}>
                      <span class="text-xs text-ink-muted">
                        {t('emailMarketing.unsubscribed')}
                      </span>
                    </Show>
                    <Show
                      when={
                        PAUSABLE.includes(entry.status) &&
                        !props.isFinished(entry)
                      }
                    >
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={props.disabled}
                        onClick={() => props.onPause(entry)}
                      >
                        {t('emailMarketing.pause')}
                      </Button>
                    </Show>
                    <Show
                      when={entry.status === 'paused' && props.campaignActive}
                    >
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={props.disabled}
                        onClick={() => props.onResume(entry)}
                      >
                        {t('emailMarketing.resume')}
                      </Button>
                    </Show>
                    <Show when={entry.status !== 'stopped'}>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={props.disabled}
                        onClick={() => props.onStop(entry)}
                      >
                        {t('emailMarketing.stop')}
                      </Button>
                    </Show>
                    <Show when={!props.isUnsubscribed(entry.contact.email)}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={props.disabled}
                        onClick={() => props.onUnsubscribe(entry.contact)}
                      >
                        {t('emailMarketing.markUnsubscribed')}
                      </Button>
                    </Show>
                  </div>
                </div>
                <ol class="mt-4 space-y-2 border-t border-edge-muted pt-3">
                  <For each={entry.steps}>
                    {(step, index) => (
                      <li class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                        <span class="ph-no-capture min-w-0 flex-1 truncate text-ink-muted">
                          {t('emailMarketing.stepLine', {
                            position: index() + 1,
                            subject: step.subject,
                          })}
                        </span>
                        <Show when={props.stepIssue(step)}>
                          {(issue) => <AttentionBadge reason={issue()} />}
                        </Show>
                        <span class="text-ink-subtle">{stepTiming(step)}</span>
                        <Show
                          when={
                            step.threadId &&
                            step.status !== 'canceled' &&
                            step.threadId
                          }
                        >
                          {(threadId) => (
                            <Button
                              type="button"
                              variant="link"
                              size="xs"
                              onClick={() => props.onOpenThread(threadId())}
                            >
                              {t('emailMarketing.openEmail')}
                            </Button>
                          )}
                        </Show>
                      </li>
                    )}
                  </For>
                </ol>
                <Show when={entry.error}>
                  {(error) => (
                    <p class="mt-3 text-xs text-failure" role="alert">
                      {enrollmentErrorMessage(error())}
                    </p>
                  )}
                </Show>
                <Show when={props.attention(entry)}>
                  {(reason) => (
                    <p class="mt-3 text-xs text-failure">
                      {attentionDetail(reason())}
                    </p>
                  )}
                </Show>
              </article>
            );
          }}
        </For>
      </Show>
      <p class="text-xs text-ink-subtle">
        {t('emailMarketing.statusNotReceipt')}
      </p>
    </div>
  );
}
