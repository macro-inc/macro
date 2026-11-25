import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';

/** The visible failure notices, one per computer. */
const showing = new Map<string, number>();

/** The inviter can retry a failed computer from its existing setup notice. */
export function showTeamAgentSetupFailure(
  computerId: string,
  agentName: string,
  failureReason: string,
  retry: () => void
) {
  if (showing.has(computerId)) return;

  const id = toast.failure(t('teamAgents.failedNotice', { name: agentName }), {
    duration: 60_000,
    onDismiss: () => showing.delete(computerId),
    subtext: failureReason,
    actions: [
      {
        label: t('teamAgents.retrySetup'),
        variant: 'primary',
        onClick: () => {
          const existing = showing.get(computerId);
          if (existing !== undefined) toast.dismiss(existing);
          retry();
        },
      },
    ],
  });
  if (id !== undefined) showing.set(computerId, id);
}
