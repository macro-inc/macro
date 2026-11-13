import { t } from '@app/lib/i18n';
import CheckIcon from '@icon/system/regular/check.svg';
import WarningCircleIcon from '@icon/system/regular/warning-circle.svg';
import type { ComputerStatus } from '@service-auth/computers';
import { Button, cn, Spinner } from '@ui';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import {
  type SetupStage,
  type SignInPlan,
  setupStages,
} from '../core/setup-progress';
import { useSetupElapsed } from '../primitives/setup-elapsed';

/**
 * Live setup progress: one row per stage from creating the computer to the
 * Claude sign-in, the current one with how long it has taken, a stuck or
 * failed one with why and what to do. The dialog shows it on every step
 * while the computer is not yet up.
 */
export function SetupProgressList(props: {
  computer: ComputerStatus;
  signIn: SignInPlan;
  connected: boolean;
  signedIn: boolean;
  /** Sets a failed computer up again; shown on the failed stage. */
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const elapsed = useSetupElapsed(() => props.computer);
  const stages = () =>
    setupStages(props.computer, {
      signIn: props.signIn,
      connected: props.connected,
      signedIn: props.signedIn,
    });
  const failed = () => props.computer.status === 'failed';

  const marker = (stage: SetupStage): JSX.Element => (
    <Switch
      fallback={
        <span
          aria-hidden="true"
          class="size-1.5 shrink-0 rounded-full border border-ink-extra-muted"
        />
      }
    >
      <Match when={stage.state === 'done'}>
        <CheckIcon
          aria-hidden="true"
          class="size-3.5 shrink-0 text-ink-muted"
        />
      </Match>
      <Match when={stage.state === 'failed'}>
        <WarningCircleIcon
          aria-hidden="true"
          class="size-3.5 shrink-0 text-failure"
        />
      </Match>
      <Match when={stage.state === 'current'}>
        <Spinner size="sm" decorative class="size-3.5 text-ink" />
      </Match>
    </Switch>
  );

  return (
    <ol
      aria-label={t('computers.setupProgressLabel')}
      class="flex flex-col gap-1.5 text-sm"
    >
      <For each={stages()}>
        {(stage) => (
          <li
            class={cn(
              'flex flex-col gap-0.5',
              stage.state === 'current' && 'text-ink',
              stage.state === 'done' && 'text-ink-muted',
              stage.state === 'upcoming' && 'text-ink-extra-muted',
              stage.state === 'skipped' && 'text-ink-extra-muted',
              stage.state === 'failed' && 'text-ink'
            )}
            aria-current={stage.state === 'current' ? 'step' : undefined}
          >
            <span class="flex items-center gap-2">
              <span class="flex size-3.5 shrink-0 items-center justify-center">
                {marker(stage)}
              </span>
              <span
                class={cn(
                  'min-w-0 flex-1',
                  stage.state === 'skipped' && 'line-through'
                )}
              >
                {stage.label}
              </span>
              <Show when={stage.state === 'current' && elapsed()}>
                {(time) => (
                  <span class="shrink-0 text-xs tabular-nums text-ink-muted">
                    {time()}
                  </span>
                )}
              </Show>
            </span>
            <Show when={stage.detail}>
              {(detail) => (
                <span
                  class={cn(
                    'pl-5.5 text-xs text-pretty',
                    stage.state === 'failed' ? 'text-failure' : 'text-ink-muted'
                  )}
                >
                  {detail()}
                </span>
              )}
            </Show>
            <Show when={stage.state === 'failed' && failed() && props.onRetry}>
              {(retry) => (
                <span class="pl-5.5 pt-1">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={props.retrying}
                    onClick={retry()}
                  >
                    {t('computers.retrySetup')}
                  </Button>
                </span>
              )}
            </Show>
          </li>
        )}
      </For>
    </ol>
  );
}
