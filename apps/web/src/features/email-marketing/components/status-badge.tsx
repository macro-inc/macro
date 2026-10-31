import { t } from '@app/lib/i18n';
import { Badge, cn, Tooltip } from '@ui';
import type { AttentionReason, Campaign, Enrollment } from '../core/model';

/** `completed`: a scheduled enrollment with nothing left to send. */
type Status = Campaign['status'] | Enrollment['status'] | 'completed';

const STATUS_LABELS = {
  draft: 'emailMarketing.statusDraft',
  active: 'emailMarketing.statusActive',
  paused: 'emailMarketing.statusPaused',
  preparing: 'emailMarketing.statusPreparing',
  scheduled: 'emailMarketing.statusScheduled',
  stopped: 'emailMarketing.statusStopped',
  needs_attention: 'emailMarketing.statusNeedsAttention',
  completed: 'emailMarketing.statusCompleted',
} as const satisfies Record<Status, string>;

/** Only the dot carries the color: tinted label text is illegible in light mode. */
const STATUS_DOTS: Record<Status, string> = {
  draft: 'bg-ink-muted',
  active: 'bg-success',
  paused: 'bg-warning',
  preparing: 'bg-warning',
  scheduled: 'bg-success',
  stopped: 'bg-ink-muted',
  needs_attention: 'bg-failure',
  completed: 'bg-ink-muted',
};

function Dot(props: { class: string }) {
  return (
    <span
      class={cn('size-1.5 shrink-0 rounded-full', props.class)}
      aria-hidden="true"
    />
  );
}

export function StatusBadge(props: { status: Status }) {
  return (
    <Badge variant="secondary" size="xs" class="text-ink">
      <Dot class={STATUS_DOTS[props.status]} />
      {t(STATUS_LABELS[props.status])}
    </Badge>
  );
}

const ATTENTION_LABELS = {
  stalled: 'emailMarketing.attentionStalled',
  failed: 'emailMarketing.attentionFailed',
  unconfirmed: 'emailMarketing.attentionUnconfirmed',
  missing: 'emailMarketing.attentionMissing',
  disconnected: 'emailMarketing.attentionDisconnected',
  interrupted: 'emailMarketing.attentionInterrupted',
} as const satisfies Record<AttentionReason, string>;

const ATTENTION_DETAILS = {
  stalled: 'emailMarketing.attentionStalledDetail',
  failed: 'emailMarketing.attentionFailedDetail',
  unconfirmed: 'emailMarketing.attentionUnconfirmedDetail',
  missing: 'emailMarketing.attentionMissingDetail',
  disconnected: 'emailMarketing.attentionDisconnectedDetail',
  interrupted: 'emailMarketing.attentionInterruptedDetail',
} as const satisfies Record<AttentionReason, string>;

export function attentionDetail(reason: AttentionReason) {
  return t(ATTENTION_DETAILS[reason]);
}

export function AttentionBadge(props: { reason: AttentionReason }) {
  return (
    <Tooltip label={attentionDetail(props.reason)} as="span" tabIndex={0}>
      <Badge variant="secondary" size="xs" class="text-ink">
        <Dot class="bg-failure" />
        {t(ATTENTION_LABELS[props.reason])}
      </Badge>
    </Tooltip>
  );
}
