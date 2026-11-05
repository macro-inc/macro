import { t } from '@app/lib/i18n';
import { AgentTag } from '@core/component/AgentTag';
import { UserIcon } from '@core/component/UserIcon';
import DotsIcon from '@icon/system/regular/dots-three.svg';
import type { TeamAgent } from '@service-auth/generated/schemas';
import { Button, Dropdown } from '@ui';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';

export function AgentStatusPill(props: {
  agent: TeamAgent;
  retrying?: boolean;
  retryError?: boolean;
  onRetry(): void;
}) {
  const computerStatus = () =>
    match(props.agent.status)
      .with('provisioning', () => 'Setting up…')
      .with('running', () => 'Running')
      .with('failed', () => 'Failed')
      .exhaustive(() => 'Status unavailable');
  const status = () =>
    match(props.agent.payment)
      .with('pending', () => 'Confirming payment')
      .with('unbilled', () => 'Payment failed / not billed')
      .with('paid', 'comped', null, undefined, () => computerStatus())
      .exhaustive(() => computerStatus());
  const canRetry = () =>
    props.agent.retryable &&
    (props.agent.payment === 'paid' || props.agent.payment === 'comped');
  const step = () =>
    match(props.agent.setup?.step)
      .with('paying', () => 'Confirming payment')
      .with('creating', () => 'Creating computer')
      .with('booting', () => 'Starting computer')
      .with('connecting', () => 'Connecting agent')
      .with('ready', () => 'Ready')
      .with(undefined, () => '')
      .exhaustive(() => 'Preparing computer');
  return (
    <div class="flex flex-wrap items-center gap-2 text-xs" role="status">
      <span
        class="rounded-full bg-ink/6 px-2 py-1"
        classList={{
          'text-failure': props.agent.status === 'failed',
          'text-success': props.agent.status === 'running',
        }}
      >
        {status()}
      </span>
      <Show when={props.agent.payment === 'comped'}>
        <span class="text-ink-muted">Included for Macro</span>
      </Show>
      <Show when={props.agent.payment === 'paid'}>
        <span class="text-ink-muted">Billed</span>
      </Show>
      <Show
        when={
          props.agent.status === 'provisioning' &&
          !(
            props.agent.payment === 'pending' &&
            props.agent.setup?.step === 'paying'
          ) &&
          props.agent.setup
        }
      >
        {(setup) => (
          <span class="text-ink-muted">
            {step()} ({setup().position}/{setup().total})
          </span>
        )}
      </Show>
      <Show when={props.agent.status === 'failed'}>
        <span class="text-failure break-words">
          {props.agent.statusReason || 'The computer could not finish setup.'}
        </span>
      </Show>
      <Show when={canRetry()}>
        <Button
          variant="ghost"
          size="sm"
          disabled={props.retrying}
          onClick={() => canRetry() && props.onRetry()}
        >
          Retry
        </Button>
        <Show when={props.retryError}>
          <span role="alert" class="text-failure">
            Couldn't retry setup. The status has been refreshed; try again if
            the agent is still failed.
          </span>
        </Show>
      </Show>
    </div>
  );
}

export function TeamAgentRow(props: {
  agent: TeamAgent;
  retrying: boolean;
  retryError?: boolean;
  onRetry(): void;
  onRemove(): void;
}) {
  return (
    <div class="flex items-start justify-between gap-2 px-4 py-4">
      <div class="flex items-start gap-3 min-w-0 flex-1">
        <UserIcon id={props.agent.userId} isDeleted={false} size="lg" />
        <div class="min-w-0 flex-1 space-y-1">
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="text-sm font-medium break-words">
              {props.agent.name}
            </span>
            <AgentTag />
          </div>
          <AgentStatusPill
            agent={props.agent}
            retrying={props.retrying}
            retryError={props.retryError}
            onRetry={props.onRetry}
          />
        </div>
      </div>
      <TeamAgentMenu agent={props.agent} onRemove={props.onRemove} />
    </div>
  );
}

export function TeamAgentMenu(props: { agent: TeamAgent; onRemove(): void }) {
  return (
    <Dropdown>
      <Dropdown.Trigger
        variant="ghost"
        size="icon-sm"
        aria-label={t('common.more')}
      >
        <DotsIcon class="size-4" />
      </Dropdown.Trigger>
      <Dropdown.Content>
        <Dropdown.Item
          disabled={props.agent.payment === 'pending'}
          onSelect={() => props.agent.payment !== 'pending' && props.onRemove()}
        >
          {t('common.removeTeamAgent')}
        </Dropdown.Item>
      </Dropdown.Content>
    </Dropdown>
  );
}
