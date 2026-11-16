import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { match } from 'ts-pattern';
import type { ComputerSetupNotice } from '../computers/primitives/setup-notice';

/** The agent teammate a computer setup notice is about. */
export type TeamAgentSetupNoticeAgent = NonNullable<
  ComputerSetupNotice['agent']
>;

/** What the notice's buttons do. */
export type TeamAgentSetupNoticeActions = {
  /** Opens the DM with the agent. */
  message: () => void;
  /** Opens Bring your AI; only for those who own the agent's computer. */
  bringAi?: () => void;
  /** Sets the failed computer up again. */
  retry: () => void;
};

/** The notices on screen, one per computer and outcome. */
const showing = new Map<string, number>();

/**
 * The in-app notice that an agent teammate is ready, or couldn't be set up,
 * for its inviter. Ready offers Message <Name>, and Bring your AI to owners
 * and admins; a failure offers Retry. It stays up a minute, since the
 * inviter left the invite minutes ago.
 */
export function showTeamAgentSetupNotice(
  notice: ComputerSetupNotice,
  agent: TeamAgentSetupNoticeAgent,
  actions: TeamAgentSetupNoticeActions
) {
  const key = `${notice.computerId}:${notice.outcome.kind}`;
  if (showing.has(key)) return;

  // Each action takes over from the notice.
  const then = (action: () => void) => () => {
    const id = showing.get(key);
    if (id !== undefined) toast.dismiss(id);
    action();
  };
  const common = {
    duration: 60_000,
    onDismiss: () => showing.delete(key),
  };

  const id = match(notice.outcome)
    .with({ kind: 'ready' }, () =>
      toast.success(t('teamAgents.readyNotice', { name: agent.name }), {
        ...common,
        subtext: t('teamAgents.readyNoticeBody', { name: agent.name }),
        actions: [
          {
            label: t('teamAgents.messageAgent', { name: agent.name }),
            variant: 'primary' as const,
            onClick: then(actions.message),
          },
          ...(actions.bringAi
            ? [
                {
                  label: t('teamAgents.bringAi'),
                  variant: 'secondary' as const,
                  onClick: then(actions.bringAi),
                },
              ]
            : []),
        ],
      })
    )
    .with({ kind: 'failed' }, ({ failureReason }) =>
      toast.failure(t('teamAgents.failedNotice', { name: agent.name }), {
        ...common,
        subtext: failureReason,
        actions: [
          {
            label: t('teamAgents.retrySetup'),
            variant: 'primary' as const,
            onClick: then(actions.retry),
          },
        ],
      })
    )
    .exhaustive();
  if (id !== undefined) showing.set(key, id);
}
