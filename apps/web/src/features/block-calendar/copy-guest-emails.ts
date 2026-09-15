import { toast } from '@core/component/Toast/Toast';
import { writeClipboardData } from '@core/util/dataTransfer';

/**
 * Copies guest addresses comma-separated, ready to paste into any To field.
 * Must be called from a user gesture.
 */
export async function copyGuestEmails(emails: string[]) {
  const written = await writeClipboardData({ 'text/plain': emails.join(', ') });
  if (written) {
    toast.success('Copied guest emails');
  } else {
    toast.failure('Failed to copy guest emails');
  }
}
