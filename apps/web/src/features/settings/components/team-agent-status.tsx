import { t } from '@app/lib/i18n';
import type { TeamAgentStatus } from '@service-auth/team-agents';
import { Spinner } from '@ui';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import { StatusDot } from '../integration-ui';

function statusLabel(status: TeamAgentStatus): string {
  return (
    match(status)
      .with('provisioning', () => t('teamAgents.statusProvisioning'))
      .with('downloading', () => t('teammateHosts.statusDownloading'))
      .with('moving', () => t('teammateHosts.statusMoving'))
      .with('starting', () => t('teamAgents.statusStarting'))
      .with('running', () => t('teamAgents.statusRunning'))
      .with('paused', () => t('teamAgents.statusPaused'))
      .with('unhealthy', () => t('teamAgents.statusUnhealthy'))
      .with('failed', () => t('teamAgents.statusFailed'))
      .with('released', () => t('teamAgents.statusReleased'))
      // A status a newer server sends reads as not running, never a crash.
      .exhaustive(() => t('teamAgents.statusNotRunning'))
  );
}

function dotState(
  status: TeamAgentStatus
): 'connected' | 'attention' | 'disconnected' {
  return match(status)
    .with('running', () => 'connected' as const)
    .with('failed', 'unhealthy', () => 'attention' as const)
    .with(
      'provisioning',
      'downloading',
      'moving',
      'starting',
      'paused',
      'released',
      () => 'disconnected' as const
    )
    .exhaustive(() => 'disconnected' as const);
}

/** Where an agent teammate is, from its computer and its own online report: a dot and a word. */
export function TeamAgentStatusLabel(props: {
  status: TeamAgentStatus;
  /** In place of the status's own word. */
  label?: string;
}) {
  return (
    <span
      role="status"
      data-agent-status={props.status}
      class="inline-flex items-center gap-1.5 text-xs text-ink-muted whitespace-nowrap"
    >
      <Show
        when={
          props.status === 'provisioning' ||
          props.status === 'moving' ||
          props.status === 'starting'
        }
        fallback={<StatusDot state={dotState(props.status)} />}
      >
        <Spinner size="sm" decorative />
      </Show>
      <span classList={{ 'text-failure': props.status === 'failed' }}>
        {props.label ?? statusLabel(props.status)}
      </span>
    </span>
  );
}
