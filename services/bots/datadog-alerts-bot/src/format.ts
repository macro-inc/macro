import type { DatadogWebhook } from './datadog';

/**
 * $ALERT_TRANSITION values, per the Datadog webhook docs. Matched
 * case-insensitively; unknown transitions fall back to 📟.
 */
const TRANSITION_EMOJI: Record<string, string> = {
  triggered: '🚨',
  're-triggered': '🚨',
  renotify: '🔁',
  warn: '⚠️',
  're-warn': '⚠️',
  recovered: '✅',
  'no data': '👻',
};

export function formatAlertMessage(payload: DatadogWebhook): string {
  const emoji = TRANSITION_EMOJI[payload.transition.toLowerCase()] ?? '📟';
  const lines = [`${emoji} [Datadog] ${payload.title}`];

  if (payload.body) {
    lines.push(payload.body.trim());
  }

  const meta: string[] = [];
  if (payload.priority) {
    meta.push(`Priority: ${payload.priority}`);
  }
  if (payload.tags) {
    meta.push(`Tags: ${payload.tags}`);
  }
  if (meta.length > 0) {
    lines.push(meta.join(' · '));
  }

  if (payload.link) {
    lines.push(payload.link);
  }

  return lines.join('\n');
}
