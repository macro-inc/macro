import { t } from '@app/lib/i18n';
import type {
  EnrollmentReason,
  EnrollmentStatus,
  SequenceStatus,
} from '@service-email/generated/schemas';
import { Badge, cn, Tooltip } from '@ui';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';

type Tone = 'neutral' | 'success' | 'warning' | 'failure';

/** Only the dot carries the color: tinted label text is illegible in light mode. */
function Dot(props: { tone: Tone }) {
  return (
    <span
      class={cn(
        'size-1.5 shrink-0 rounded-full',
        match(props.tone)
          .with('neutral', () => 'bg-ink-muted')
          .with('success', () => 'bg-success')
          .with('warning', () => 'bg-warning')
          .with('failure', () => 'bg-failure')
          .exhaustive()
      )}
      aria-hidden="true"
    />
  );
}

const SEQUENCE_STATUS = {
  draft: 'sequences.statusDraft',
  active: 'sequences.statusActive',
  paused: 'sequences.statusPaused',
} as const satisfies Record<SequenceStatus, string>;

export function SequenceStatusBadge(props: { status: SequenceStatus }) {
  return (
    <Badge variant="secondary" size="xs" class="text-ink">
      <Dot
        tone={match(props.status)
          .with('draft', () => 'neutral' as const)
          .with('active', () => 'success' as const)
          .with('paused', () => 'warning' as const)
          .exhaustive()}
      />
      {t(SEQUENCE_STATUS[props.status])}
    </Badge>
  );
}

const ENROLLMENT_STATUS = {
  active: 'sequences.enrollmentActive',
  paused: 'sequences.enrollmentPaused',
  needs_attention: 'sequences.enrollmentNeedsAttention',
  stopped: 'sequences.enrollmentStopped',
  completed: 'sequences.enrollmentCompleted',
} as const satisfies Record<EnrollmentStatus, string>;

const REASON_LABEL = {
  manual: 'sequences.reasonManual',
  replied: 'sequences.reasonReplied',
  bounced: 'sequences.reasonBounced',
  unsubscribed: 'sequences.reasonUnsubscribed',
  access_lost: 'sequences.reasonAccessLost',
  inbox_unavailable: 'sequences.reasonInboxUnavailable',
  step_failed: 'sequences.reasonStepFailed',
  step_withdrawn: 'sequences.reasonStepWithdrawn',
  step_unknown: 'sequences.reasonStepUnknown',
  step_stuck: 'sequences.reasonStepStuck',
} as const satisfies Record<EnrollmentReason, string>;

const REASON_DETAIL = {
  manual: 'sequences.reasonManualDetail',
  replied: 'sequences.reasonRepliedDetail',
  bounced: 'sequences.reasonBouncedDetail',
  unsubscribed: 'sequences.reasonUnsubscribedDetail',
  access_lost: 'sequences.reasonAccessLostDetail',
  inbox_unavailable: 'sequences.reasonInboxUnavailableDetail',
  step_failed: 'sequences.reasonStepFailedDetail',
  step_withdrawn: 'sequences.reasonStepWithdrawnDetail',
  step_unknown: 'sequences.reasonStepUnknownDetail',
  step_stuck: 'sequences.reasonStepStuckDetail',
} as const satisfies Record<EnrollmentReason, string>;

export function reasonDetail(reason: EnrollmentReason) {
  return t(REASON_DETAIL[reason]);
}

function EnrollmentBadge(props: {
  status: EnrollmentStatus;
  reason?: EnrollmentReason | null;
}) {
  return (
    <Badge variant="secondary" size="xs" class="text-ink">
      <Dot
        tone={match(props.status)
          .with('active', () => 'success' as const)
          .with('paused', () => 'warning' as const)
          .with('needs_attention', () => 'failure' as const)
          .with('stopped', 'completed', () => 'neutral' as const)
          .exhaustive()}
      />
      <Show when={props.reason} fallback={t(ENROLLMENT_STATUS[props.status])}>
        {(reason) =>
          t('sequences.statusWithReason', {
            status: t(ENROLLMENT_STATUS[props.status]),
            reason: t(REASON_LABEL[reason()]),
          })
        }
      </Show>
    </Badge>
  );
}

/** An enrollment's status and why; the reason's explanation is its tooltip. */
export function EnrollmentStatusBadge(props: {
  status: EnrollmentStatus;
  reason?: EnrollmentReason | null;
}) {
  return (
    <Show
      when={props.reason}
      fallback={<EnrollmentBadge status={props.status} />}
    >
      {(reason) => (
        <Tooltip label={reasonDetail(reason())} as="span" tabIndex={0}>
          <EnrollmentBadge status={props.status} reason={reason()} />
        </Tooltip>
      )}
    </Show>
  );
}
