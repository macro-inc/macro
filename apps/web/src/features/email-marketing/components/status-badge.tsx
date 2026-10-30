import type { AttentionReason } from '../core/model';

export function StatusBadge(props: { status: string }) {
  const label = () =>
    props.status === 'needs_attention'
      ? 'Needs attention'
      : props.status.charAt(0).toUpperCase() + props.status.slice(1);
  return (
    <span
      class="inline-flex items-center gap-1.5 rounded-full bg-panel px-2.5 py-1 text-xs font-medium"
      classList={{
        'text-success':
          props.status === 'active' || props.status === 'scheduled',
        'text-warning':
          props.status === 'paused' || props.status === 'preparing',
        'text-failure': props.status === 'needs_attention',
        'text-ink-muted': ['draft', 'stopped', 'archived'].includes(
          props.status
        ),
      }}
    >
      <span class="size-1.5 rounded-full bg-current" />
      {label()}
    </span>
  );
}

const ATTENTION_LABELS: Record<AttentionReason, string> = {
  stalled: 'Not sent yet',
  failed: 'Send failed',
  unconfirmed: 'Send unconfirmed',
  missing: 'Removed from Scheduled',
  disconnected: 'Inbox disconnected',
};

const ATTENTION_DETAILS: Record<AttentionReason, string> = {
  stalled:
    'Still scheduled well after its send time. Check Drafts → Scheduled in Mail.',
  failed:
    'Gmail rejected this email, often for a sending limit. It will not retry; open it in Drafts → Scheduled to send it again.',
  unconfirmed:
    'Gmail may or may not have sent this email. Check your Sent folder before sending it again.',
  missing:
    'This email was deleted or sent outside Email Marketing, so it is no longer scheduled.',
  disconnected:
    'This inbox is no longer connected, so its queued emails were canceled. Reconnect it and choose it on the campaign.',
};

export function attentionDetail(reason: AttentionReason) {
  return ATTENTION_DETAILS[reason];
}

export function AttentionBadge(props: { reason: AttentionReason }) {
  return (
    <span
      class="inline-flex items-center gap-1.5 rounded-full bg-panel px-2.5 py-1 text-xs font-medium text-failure"
      title={ATTENTION_DETAILS[props.reason]}
    >
      <span class="size-1.5 rounded-full bg-current" />
      {ATTENTION_LABELS[props.reason]}
    </span>
  );
}
