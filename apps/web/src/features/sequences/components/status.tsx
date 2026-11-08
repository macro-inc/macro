import { formatLocale, t } from '@app/lib/i18n';
import type {
  EnrollmentReason,
  EnrollmentStatus,
  SequenceStatus,
} from '@service-email/generated/schemas';
import { Badge, cn } from '@ui';
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
  contact_removed: 'sequences.reasonContactRemoved',
} as const satisfies Record<EnrollmentReason, string>;

const REASON_DETAIL = {
  manual: 'sequences.reasonManualDetail',
  replied: 'sequences.reasonRepliedDetail',
  bounced: 'sequences.reasonBouncedDetail',
  unsubscribed: 'sequences.reasonUnsubscribedDetail',
  contact_removed: 'sequences.reasonContactRemovedDetail',
} as const satisfies Record<EnrollmentReason, string>;

/** What the owner should know about an enrollment's status, if anything. */
export function enrollmentDetail(
  status: EnrollmentStatus,
  reason: EnrollmentReason | null | undefined
) {
  if (status === 'needs_attention') return t('sequences.needsAttentionDetail');
  return reason ? t(REASON_DETAIL[reason]) : undefined;
}

export function EnrollmentStatusBadge(props: {
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

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(formatLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

/** When the last email went and, while sending, when the next one goes. */
export function SendTimes(props: {
  lastSentAt?: string | null;
  nextSendAt?: string | null;
  sending: boolean;
}) {
  return (
    <>
      <Show when={props.lastSentAt}>
        {(sent) => (
          <span>
            {t('sequences.lastSent', { time: formatDateTime(sent()) })}
          </span>
        )}
      </Show>
      <Show when={props.sending && props.nextSendAt}>
        {(next) => (
          <span>
            {t('sequences.nextSend', { time: formatDateTime(next()) })}
          </span>
        )}
      </Show>
    </>
  );
}
