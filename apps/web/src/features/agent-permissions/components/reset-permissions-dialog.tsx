import { t } from '@app/lib/i18n';
import { ConfirmDialog } from '@ui';
import { Show } from 'solid-js';

/**
 * Confirms putting every saved setting back to Allow, including rules on
 * actions no tool uses yet.
 */
export function ResetPermissionsDialog(props: {
  open: boolean;
  agent: string;
  /** Settings the agent made restricting itself. */
  byAgent: number;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      tone="danger"
      pending={props.pending}
      title={t('agentPermissions.resetTitle', { agent: props.agent })}
      confirmLabel={t('agentPermissions.resetConfirm')}
      cancelLabel={t('agentPermissions.cancel')}
      onConfirm={props.onConfirm}
      body={
        <p>
          {t('agentPermissions.resetBody')}
          <Show when={props.byAgent > 0}>
            {' '}
            {t('agentPermissions.resetBodyAgent', {
              count: props.byAgent,
              agent: props.agent,
            })}
          </Show>{' '}
          {t('agentPermissions.resetBodyEnd', { agent: props.agent })}
        </p>
      }
    />
  );
}
