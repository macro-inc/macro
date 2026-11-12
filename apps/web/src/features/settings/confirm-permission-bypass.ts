import { t } from '@app/lib/i18n';
import { confirmDialog, type OpenDialogOptions } from '@ui';

/**
 * The one confirmation for letting a machine's agents skip permission
 * requests, asked wherever it is turned on: the machine's "Don't ask before
 * acting" switch in Settings, or a session's permission request.
 * `alsoSetsAgent` adds that the asking agent is set to bypass too.
 */
export function confirmPermissionBypass(
  options?: { alsoSetsAgent?: boolean },
  dialogOptions?: OpenDialogOptions
): Promise<boolean> {
  const body = t('runtimeSharing.dontAskConfirmBody');
  return confirmDialog(
    {
      title: t('runtimeSharing.dontAskConfirmTitle'),
      body: options?.alsoSetsAgent
        ? `${body} ${t('runtimeSharing.dontAskConfirmAlsoSetsAgent')}`
        : body,
      confirmLabel: t('runtimeSharing.dontAskConfirm'),
      tone: 'danger',
    },
    dialogOptions
  );
}
