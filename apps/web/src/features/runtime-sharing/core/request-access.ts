import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { requestHarnessAccess } from '@queries/harnesses/harnesses';
import { match } from 'ts-pattern';

/**
 * Ask a runtime's owner for User access and say how it went. Every Request
 * access button goes through here, so each one answers the same way.
 */
export async function requestRuntimeAccess(harnessId: string): Promise<void> {
  try {
    const outcome = await requestHarnessAccess(harnessId);
    match(outcome)
      .with('sent', () => toast.success(t('runtimeSharing.requestSent')))
      .with('already_requested', () =>
        toast.success(t('runtimeSharing.alreadyRequested'))
      )
      .exhaustive();
  } catch {
    toast.failure(t('runtimeSharing.requestFailed'));
  }
}
