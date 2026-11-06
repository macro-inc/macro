import { t } from '@app/lib/i18n';
import type { TeamAgent } from '@service-auth/generated/schemas';
import { Button, Tooltip } from '@ui';
import { For, Show } from 'solid-js';
import { match } from 'ts-pattern';

export function AgentStatusPill(props: {
  agent: TeamAgent;
  activity?: string;
  canManage?: boolean;
  onOpenBilling?(): void;
}) {
  const status = () =>
    props.agent.payment === 'pending' || props.agent.payment === 'unbilled'
      ? 'Setting up…'
      : match(props.agent.status)
          .with('running', () => 'Running')
          .with('unhealthy', () => 'Unhealthy')
          .with('provisioning', 'failed', () => 'Setting up…')
          .exhaustive(() => 'Setting up…');
  // Older servers may still send the retired payment step. It has no UI step.
  const step = () =>
    match(props.agent.setup?.step)
      .with('creating', () => 'Creating')
      .with('booting', () => 'Booting')
      .with('connecting', () => 'Connecting')
      .otherwise(() => undefined);
  const settingUp = () => status() === 'Setting up…';
  const position = () =>
    match(props.agent.setup?.step)
      .with('creating', () => 1)
      .with('booting', () => 2)
      .with('connecting', () => 3)
      .otherwise(() => 0);
  const total = () => 3;
  const setupLabel = () =>
    step() ? `${step()} — step ${position()} of ${total()}` : 'Setting up…';
  const tooltip = () =>
    [
      settingUp() ? setupLabel() : props.agent.statusReason || status(),
      props.activity,
    ]
      .filter(Boolean)
      .join(' · ');
  return (
    <Show
      when={props.canManage && props.agent.payment === 'unbilled'}
      fallback={
        <Tooltip label={tooltip()} tabIndex={0} class="min-w-0 max-w-full">
          <div
            class="inline-flex min-w-0 max-w-full items-center text-xs"
            role="status"
          >
            <Show
              when={settingUp()}
              fallback={
                <span
                  class="max-w-full truncate rounded-full bg-ink/6 px-2 py-1"
                  classList={{
                    'text-failure': props.agent.status === 'unhealthy',
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
                aria-valuemax={total()}
                aria-valuenow={position()}
                aria-valuetext={setupLabel()}
              >
                <span
                  class="text-[10px] leading-3 text-ink-muted"
                  aria-hidden="true"
                >
                  Setting up…
                </span>
                <Show when={step()}>
                  <span
                    class="text-[10px] leading-3 text-ink-muted"
                    aria-hidden="true"
                  >
                    {step()}
                  </span>
                </Show>
                <div class="flex gap-1" aria-hidden="true">
                  <For
                    each={Array.from(
                      { length: total() },
                      (_, index) => index + 1
                    )}
                  >
                    {(index) => (
                      <span
                        class="h-1 flex-1 rounded-full"
                        classList={{
                          'bg-accent': index <= position(),
                          'bg-ink/10': index > position(),
                        }}
                      />
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>
        </Tooltip>
      }
    >
      <div class="text-xs text-failure" role="status">
        <span>{t('agentInvite.addFailed', { name: props.agent.name })}</span>{' '}
        <Button
          as="a"
          href="/app/settings/billing"
          variant="link"
          size="sm"
          onClick={(event) => {
            if (props.onOpenBilling) {
              event.preventDefault();
              props.onOpenBilling();
            }
          }}
        >
          {t('agentInvite.billing')}
        </Button>
      </div>
    </Show>
  );
}
