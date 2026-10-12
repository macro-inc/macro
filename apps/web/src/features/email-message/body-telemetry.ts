import { analytics } from '@app/lib/analytics';
import type { EmailBodyShown } from './context/email-rendering-context';

const SEEN_LIMIT = 5_000;
// Message ids already shown in this page load; only `repeat` leaves the tab.
const seen = new Set<string>();

/** Sends one rollout sample; viewers outside the rollout send nothing. */
export function reportEmailBodyShown(
  shown: EmailBodyShown,
  arm: string | undefined
): void {
  if (!arm) return;
  const repeat = seen.has(shown.messageId);
  if (!repeat) {
    if (seen.size >= SEEN_LIMIT) seen.clear();
    seen.add(shown.messageId);
  }
  analytics.track('email_body_shown', {
    arm,
    path: shown.path,
    source: shown.source,
    repeat,
    prepare_ms: Math.round(shown.prepareMs * 10) / 10,
    mount_ms: Math.round(shown.mountMs * 10) / 10,
    total_ms: Math.round(shown.totalMs * 10) / 10,
    html_kb: Math.round(shown.htmlLength / 1024),
  });
}
