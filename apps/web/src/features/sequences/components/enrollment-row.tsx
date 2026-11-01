import { formatLocale, t } from '@app/lib/i18n';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import type {
  EnrollmentAction,
  EnrollmentStatus,
  EnrollmentStep,
  EnrollmentSummary,
} from '@service-email/generated/schemas';
import { Button, cn } from '@ui';
import { createMemo, createUniqueId, For, type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { EnrollmentStatusBadge, reasonDetail } from './status-badge';

function createTimeFormat() {
  return createMemo(
    () =>
      new Intl.DateTimeFormat(formatLocale(), {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
  );
}

function actionLabel(action: EnrollmentAction, retry: boolean) {
  return match(action)
    .with('resume', () =>
      retry ? t('sequences.retry') : t('sequences.resume')
    )
    .with('pause', () => t('sequences.pause'))
    .with('stop', () => t('sequences.stop'))
    .with('unsubscribe', () => t('sequences.unsubscribe'))
    .exhaustive();
}

/** One person in a sequence; its frozen steps open below it. */
export function EnrollmentRow(props: {
  enrollment: EnrollmentSummary;
  /** The status to show, which a paused sequence holds at paused. */
  status: EnrollmentStatus;
  actions: readonly EnrollmentAction[];
  retry: boolean;
  busy: boolean;
  expanded: boolean;
  onToggle: () => void;
  onAction: (action: EnrollmentAction) => void;
  onOpenContact?: () => void;
  children?: JSX.Element;
}) {
  const time = createTimeFormat();
  const detailsId = createUniqueId();
  // Named by the masked heading, not an attribute session replay would record.
  const nameId = createUniqueId();
  const label = () => props.enrollment.contactName || props.enrollment.email;
  return (
    <article
      class="rounded-xl border border-edge-muted p-4"
      aria-labelledby={nameId}
    >
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('sequences.showSteps')}
            aria-expanded={props.expanded}
            aria-controls={detailsId}
            onClick={() => props.onToggle()}
          >
            <CaretDownIcon
              class={cn(
                'size-4 transition-transform',
                !props.expanded && 'rotate-180'
              )}
              aria-hidden="true"
            />
          </Button>
          <div class="ph-no-capture min-w-0">
            <Show
              when={props.onOpenContact}
              fallback={
                <p id={nameId} class="truncate text-sm font-medium">
                  {label()}
                </p>
              }
            >
              {(open) => (
                <Button
                  id={nameId}
                  type="button"
                  variant="link"
                  size="sm"
                  class="max-w-full truncate px-0 text-ink"
                  onClick={() => open()()}
                >
                  {label()}
                </Button>
              )}
            </Show>
            <p class="truncate text-xs text-ink-muted">
              {props.enrollment.email}
            </p>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <EnrollmentStatusBadge
            status={props.status}
            reason={props.enrollment.reason}
          />
          <For each={props.actions}>
            {(action) => (
              <Button
                type="button"
                variant={action === 'unsubscribe' ? 'ghost' : 'secondary'}
                size="sm"
                disabled={props.busy}
                onClick={() => props.onAction(action)}
              >
                {actionLabel(action, props.retry)}
              </Button>
            )}
          </For>
        </div>
      </div>
      <p class="mt-2 flex flex-wrap gap-x-3 text-xs text-ink-muted">
        <span>
          {t('sequences.stepProgress', {
            done: Math.min(
              props.enrollment.nextStep,
              props.enrollment.stepCount
            ),
            total: props.enrollment.stepCount,
          })}
        </span>
        <Show when={props.enrollment.lastSentAt}>
          {(sent) => (
            <span>
              {t('sequences.lastSent', {
                time: time().format(new Date(sent())),
              })}
            </span>
          )}
        </Show>
        <Show when={props.status === 'active' && props.enrollment.nextSendAt}>
          {(next) => (
            <span>
              {t('sequences.nextSend', {
                time: time().format(new Date(next())),
              })}
            </span>
          )}
        </Show>
      </p>
      <Show when={props.expanded}>
        <div
          id={detailsId}
          class="mt-3 space-y-3 border-t border-edge-muted pt-3"
        >
          <Show when={props.enrollment.reason}>
            {(reason) => (
              <p class="text-xs text-ink-muted">{reasonDetail(reason())}</p>
            )}
          </Show>
          {props.children}
        </div>
      </Show>
    </article>
  );
}

function stepState(
  step: EnrollmentStep,
  format: (value: string) => string
): string {
  return match(step.status)
    .with('pending', () => t('sequences.stepPending'))
    .with('scheduled', () =>
      step.scheduledAt
        ? t('sequences.stepScheduled', { time: format(step.scheduledAt) })
        : t('sequences.stepPending')
    )
    .with('sent', () =>
      step.sentAt
        ? t('sequences.stepSent', { time: format(step.sentAt) })
        : t('sequences.stepSentUndated')
    )
    .with('unknown', () => t('sequences.stepUnknown'))
    .exhaustive(() => t('sequences.stepPending'));
}

/** The emails exactly as this person gets them, and what happened to each. */
export function EnrollmentSteps(props: { steps: readonly EnrollmentStep[] }) {
  const time = createTimeFormat();
  const format = (value: string) => time().format(new Date(value));
  return (
    <ol class="space-y-3">
      <For each={props.steps}>
        {(step, index) => (
          <li class="space-y-1 text-xs">
            <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span class="font-medium">
                {t('sequences.emailNumber', { position: index() + 1 })}
              </span>
              <span class="text-ink-muted">{stepState(step, format)}</span>
            </div>
            <div class="ph-no-capture rounded-lg bg-panel/50 px-3 py-2">
              <p class="truncate font-medium">{step.subject}</p>
              <p class="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-ink-muted">
                {step.body}
              </p>
            </div>
          </li>
        )}
      </For>
    </ol>
  );
}
