import { t } from '@app/lib/i18n';
import { useChannelParticipants } from '@channel/use-channel-participants';
import { useUserId } from '@core/context/user';
import { isAgentAccount, tryMacroId } from '@core/user';
import { fireAndForget } from '@core/util/fireAndForget';
import WarningCircleIcon from '@icon/system/regular/warning-circle.svg';
import { useIsTeamAdmin } from '@queries/team/teams';
import { Button, Spinner } from '@ui';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import type { TeamAgentRunState } from '../core/team-agent-setup';
import {
  useRetryTeamAgentSetup,
  useTeamAgentStatus,
} from '../primitives/team-agent-status';

/** The agent account on the other side of a DM, if it is one. */
function useDmAgentAccount(channelId: () => string) {
  const userId = useUserId();
  const participants = useChannelParticipants(channelId);
  return () => {
    const ids = participants.ids();
    const other = ids.find((id) => id !== userId());
    // A DM has two people; only an agent account can be a team agent.
    if (!other || ids.length !== 2) return undefined;
    return isAgentAccount(tryMacroId(other)) ? other : undefined;
  };
}

type NotRunning = Exclude<TeamAgentRunState, 'running'>;

function notRunning(
  state: TeamAgentRunState | undefined
): NotRunning | undefined {
  return state === 'running' ? undefined : state;
}

function bannerText(state: NotRunning, name: string): string {
  return match(state)
    .with('setting_up', () => t('teamAgents.dmSettingUp', { name }))
    .with('setup_failed', () => t('teamAgents.dmSetupFailed', { name }))
    .with('offline', () => t('teamAgents.dmOffline', { name }))
    .with('not_running', () => t('teamAgents.dmNotRunning', { name }))
    .exhaustive();
}

function chipText(state: NotRunning): string {
  return match(state)
    .with('setting_up', () => t('teamAgents.statusProvisioning'))
    .with('setup_failed', () => t('teamAgents.statusSetupFailed'))
    .with('offline', () => t('teamAgents.statusOffline'))
    .with('not_running', () => t('teamAgents.statusNotRunning'))
    .exhaustive();
}

/**
 * Above the composer in a DM with an agent teammate that isn't running:
 * what to expect from a message sent now. Messages still send; owners and
 * admins can retry a failed setup from here.
 */
export function TeamAgentDmBanner(props: { channelId: string }) {
  const agentUserId = useDmAgentAccount(() => props.channelId);
  return <TeamAgentStatusBanner userId={agentUserId()} />;
}

/** The banner for the agent teammate `userId` names; nothing for anyone else. */
export function TeamAgentStatusBanner(props: { userId: string | undefined }) {
  const status = useTeamAgentStatus(() => props.userId);
  const isAdmin = useIsTeamAdmin();
  const retry = useRetryTeamAgentSetup();
  const state = () => notRunning(status.state());

  return (
    <Show when={status.agent() && state()}>
      {(current) => (
        <div class="mb-2 flex w-full justify-center touch:px-(--mobile-chrome-gutter) touch:pointer-events-auto">
          <div
            role="status"
            data-agent-dm-status={current()}
            class="macro-message-width flex w-full min-w-0 items-center gap-2.5 rounded-2xl border border-edge-muted bg-panel px-3 py-2.5 text-sm text-ink"
          >
            <Show
              when={current() === 'setting_up'}
              fallback={
                <WarningCircleIcon
                  aria-hidden="true"
                  class="size-4 shrink-0 text-ink-muted"
                />
              }
            >
              <Spinner size="sm" decorative class="shrink-0" />
            </Show>
            <span class="min-w-0 flex-1">
              {bannerText(current(), status.agent()?.name ?? '')}
            </span>
            <Show when={current() === 'setup_failed' && isAdmin()}>
              <Button
                size="sm"
                variant="secondary"
                class="shrink-0"
                disabled={retry.pending()}
                onClick={() => {
                  const agent = status.agent();
                  if (agent)
                    fireAndForget(retry.run(agent), 'team-agent.retry');
                }}
              >
                {t('teamAgents.retrySetup')}
              </Button>
            </Show>
          </div>
        </div>
      )}
    </Show>
  );
}

/** In a DM's header: a short word for an agent teammate that isn't running. */
export function TeamAgentDmStatusChip(props: { channelId: string }) {
  const agentUserId = useDmAgentAccount(() => props.channelId);
  return <TeamAgentStatusChip userId={agentUserId()} />;
}

/** The chip for the agent teammate `userId` names; nothing for anyone else. */
export function TeamAgentStatusChip(props: { userId: string | undefined }) {
  const status = useTeamAgentStatus(() => props.userId);
  const state = () => notRunning(status.state());

  return (
    <Show when={status.agent() && state()}>
      {(current) => (
        <span
          data-agent-dm-chip={current()}
          class="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-edge-muted px-2 py-0.5 text-xs text-ink-muted"
        >
          <Show
            when={current() === 'setting_up'}
            fallback={
              <span
                aria-hidden="true"
                class="size-1.5 shrink-0 rounded-full bg-ink-extra-muted"
              />
            }
          >
            <Spinner size="sm" decorative />
          </Show>
          {chipText(current())}
        </span>
      )}
    </Show>
  );
}
