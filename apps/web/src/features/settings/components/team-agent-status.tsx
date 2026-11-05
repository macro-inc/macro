import type { TeamAgent } from '@service-auth/generated/schemas';
import { Tooltip } from '@ui';
import { For, Show } from 'solid-js';
import { match } from 'ts-pattern';

export function AgentStatusPill(props: {
  agent: TeamAgent;
  activity?: string;
}) {
  const computerStatus = () =>
    match(props.agent.status)
      .with('provisioning', () => 'Setting up…')
      .with('running', () => 'Running')
      .with('unhealthy', () => 'Unhealthy')
      .with('failed', () => 'Failed')
      .exhaustive(() => 'Status unavailable');
  const status = () =>
    match(props.agent.payment)
      .with('pending', () => 'Confirming payment')
      .with('unbilled', () => 'Payment failed')
      .with('paid', 'comped', null, undefined, () => computerStatus())
      .exhaustive(() => computerStatus());
  const step = () =>
    match(props.agent.setup?.step)
      .with('paying', () => 'Paying')
      .with('creating', () => 'Creating')
      .with('booting', () => 'Booting')
      .with('connecting', () => 'Connecting')
      .with('ready', () => 'Ready')
      .with(undefined, () => 'Paying')
      .exhaustive(() => 'Preparing computer');
  const tooltip = () =>
    [
      props.agent.status === 'provisioning'
        ? `${step()} — step ${props.agent.setup?.position ?? 1} of 5`
        : props.agent.statusReason || status(),
      props.activity,
    ]
      .filter(Boolean)
      .join(' · ');
  return (
    <Tooltip label={tooltip()} tabIndex={0} class="min-w-0 max-w-full">
      <div
        class="inline-flex min-w-0 max-w-full items-center text-xs"
        role="status"
      >
        <Show
          when={props.agent.status === 'provisioning'}
          fallback={
            <span
              class="max-w-full truncate rounded-full bg-ink/6 px-2 py-1"
              classList={{
                'text-failure':
                  props.agent.status === 'failed' ||
                  props.agent.status === 'unhealthy',
                'text-success': props.agent.status === 'running',
              }}
            >
              {status()}
            </span>
          }
        >
          <div
            class="flex w-18 sm:w-24 flex-col gap-1 py-2"
            role="progressbar"
            aria-label="Agent setup"
            aria-valuemin={0}
            aria-valuemax={5}
            aria-valuenow={props.agent.setup?.position ?? 1}
            aria-valuetext={`${step()} — step ${props.agent.setup?.position ?? 1} of 5`}
          >
            <span
              class="text-[10px] leading-3 text-ink-muted"
              aria-hidden="true"
            >
              {step()}
            </span>
            <div class="flex gap-1" aria-hidden="true">
              <For each={[1, 2, 3, 4, 5]}>
                {(position) => (
                  <span
                    class="h-1 flex-1 rounded-full"
                    aria-hidden="true"
                    classList={{
                      'bg-accent':
                        position <= (props.agent.setup?.position ?? 1),
                      'bg-ink/10':
                        position > (props.agent.setup?.position ?? 1),
                    }}
                  />
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>
    </Tooltip>
  );
}
