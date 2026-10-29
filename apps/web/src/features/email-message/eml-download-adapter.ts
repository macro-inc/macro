import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { downloadFile } from '@filesystem/download';
import { Telemetry } from '@macro-inc/observability';
import { getEmailMessageEml } from '@queries/email/message-source';
import type { EmailMessage } from './core/email-message';

const MAX_FILENAME_STEM_CHARS = 120;

/** The server's `.eml` name: unsafe characters become spaces, empty is "email". */
export function emlFilename(subject: string | null | undefined) {
  const stem = (subject ?? '')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: file names must not carry control characters
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
    .slice(0, MAX_FILENAME_STEM_CHARS)
    .trim()
    .replace(/^\.+|\.+$/g, '');
  return `${stem || 'email'}.eml`;
}

/** Save a message's original source, as the provider holds it, as `.eml`. */
export async function downloadEmailMessageEml(
  message: Pick<EmailMessage, 'db_id' | 'subject'>
) {
  return Telemetry.span('email.download_eml', async (span) => {
    span.setAttr('email.message_id', message.db_id);
    const result = await getEmailMessageEml(message.db_id);
    if (result.isErr()) {
      span.error('EML download failed');
      toast.failure(t('entityActions.downloadEmlFailed'));
      return;
    }
    await downloadFile(
      new Blob([result.value], { type: 'message/rfc822' }),
      emlFilename(message.subject)
    );
  });
}
