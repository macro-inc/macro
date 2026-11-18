import { t } from '@app/lib/i18n';
import { ConfirmDialog } from '@ui';
import { Show } from 'solid-js';

/** Confirms putting every saved setting back to Always allow. */
export function ResetPermissionsDialog(props: {
  open: boolean;
  agent: string;
  counts: { total: number; byAgent: number; tools: number };
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
          {t('agentPermissions.resetBody', { count: props.counts.total })}
          <Show when={props.counts.byAgent > 0}>
            {' '}
            {t('agentPermissions.resetBodyAgent', {
              count: props.counts.byAgent,
              agent: props.agent,
            })}
          </Show>
          <Show when={props.counts.tools > 0}>
            {' '}
            {t('agentPermissions.resetBodyTools', {
              count: props.counts.tools,
            })}
          </Show>{' '}
          {t('agentPermissions.resetBodyEnd', { agent: props.agent })}
        </p>
      }
    />
  );
}
