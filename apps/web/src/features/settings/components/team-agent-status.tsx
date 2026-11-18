import { t } from '@app/lib/i18n';
import type { TeamAgentStatus } from '@service-auth/team-agents';
import { Spinner } from '@ui';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import { StatusDot } from '../integration-ui';

function statusLabel(status: TeamAgentStatus): string {
  return match(status)
    .with('provisioning', () => t('teamAgents.statusProvisioning'))
    .with('starting', () => t('teamAgents.statusStarting'))
    .with('running', () => t('teamAgents.statusRunning'))
    .with('paused', () => t('teamAgents.statusPaused'))
    .with('failed', () => t('teamAgents.statusFailed'))
    .with('released', () => t('teamAgents.statusReleased'))
    .exhaustive();
}

function dotState(
  status: TeamAgentStatus
): 'connected' | 'attention' | 'disconnected' {
  return match(status)
    .with('running', () => 'connected' as const)
    .with('failed', () => 'attention' as const)
    .with(
      'provisioning',
      'starting',
      'paused',
      'released',
      () => 'disconnected' as const
    )
    .exhaustive();
}

/** Where an agent teammate is, from its computer and its own online report: a dot and a word. */
export function TeamAgentStatusLabel(props: { status: TeamAgentStatus }) {
  return (
    <span
      role="status"
      data-agent-status={props.status}
      class="inline-flex items-center gap-1.5 text-xs text-ink-muted whitespace-nowrap"
    >
      <Show
        when={props.status === 'provisioning' || props.status === 'starting'}
        fallback={<StatusDot state={dotState(props.status)} />}
      >
        <Spinner size="sm" decorative />
      </Show>
      <span classList={{ 'text-failure': props.status === 'failed' }}>
        {statusLabel(props.status)}
      </span>
    </span>
  );
}
