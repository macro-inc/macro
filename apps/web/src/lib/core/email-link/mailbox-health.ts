import { formatLocale, t } from '@app/lib/i18n';

/** Guidance uses the projected deadline; legacy/unknown dates make no timing promise. */
export function mailboxSizeGuidance(
  retryAt: string | null | undefined
): string {
  const date = retryAt ? new Date(retryAt) : undefined;
  if (!date || Number.isNaN(date.getTime())) return t('imap.mailboxSizePaused');
  return t('imap.mailboxSizeRetry', {
    time: date.toLocaleString(formatLocale(), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }),
  });
}
