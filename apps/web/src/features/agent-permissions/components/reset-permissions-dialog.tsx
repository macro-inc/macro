import { t } from '@app/lib/i18n';
import { ConfirmDialog } from '@ui';
import { Show } from 'solid-js';

/**
 * Confirms putting every saved setting back to Allow, including rules on
 * actions no tool uses yet. For an agent that follows another's permissions
 * (`follows`, the source's mention), Reset removes only its own
 * restrictions and it keeps following, so the dialog says that instead.
 */
export function ResetPermissionsDialog(props: {
  open: boolean;
  agent: string;
  /** Replaces "Reset <agent>'s permissions?". */
  title?: string;
  /** A team's default has no sessions: leave out the session note. */
  team?: boolean;
  /** Settings the agent made restricting itself. */
  byAgent: number;
  /** What the agent follows, when it follows another's permissions. */
  follows?: string;
  /** Other agents follow these permissions (Macro's), so they change too. */
  followed?: boolean;
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
      title={
        props.title ??
        (props.follows
          ? t('agentPermissions.removeRestrictionsTitle', {
              agent: props.agent,
            })
          : t('agentPermissions.resetTitle', { agent: props.agent }))
      }
      confirmLabel={
        props.follows
          ? t('agentPermissions.removeRestrictions')
          : t('agentPermissions.resetConfirm')
      }
      cancelLabel={t('agentPermissions.cancel')}
      onConfirm={props.onConfirm}
      body={
        <p>
          {props.follows
            ? t('agentPermissions.removeRestrictionsBody', {
                source: props.follows,
              })
            : t('agentPermissions.resetBody')}
          <Show when={props.byAgent > 0}>
            {' '}
            {t('agentPermissions.resetBodyAgent', {
              count: props.byAgent,
              agent: props.agent,
            })}
          </Show>
          <Show when={props.followed}>
            {' '}
            {t('agentPermissions.resetBodyFollowers')}
          </Show>
          <Show when={!props.team}>
            {' '}
            {t('agentPermissions.resetBodyEnd', { agent: props.agent })}
          </Show>
        </p>
      }
    />
  );
}
