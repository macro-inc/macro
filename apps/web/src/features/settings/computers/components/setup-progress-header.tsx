import { t } from '@app/lib/i18n';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import MinusIcon from '@icon/system/regular/minus.svg';
import WarningCircleIcon from '@icon/system/regular/warning-circle.svg';
import type { ComputerStatus } from '@service-auth/computers';
import { Button, cn, Spinner } from '@ui';
import {
  createSignal,
  createUniqueId,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import {
  type SetupStage,
  type SignInPlan,
  setupFailure,
  setupProgressLine,
  setupStages,
} from '../core/setup-progress';
import { useSetupElapsed } from '../primitives/setup-elapsed';
import { FailureNotice } from './failure-notice';

/**
 * Every stage from creating the computer to the Claude sign-in: done ones
 * with a check, the current one with how long it has taken, a stuck one with
 * why.
 */
function SetupProgressList(props: {
  id: string;
  stages: readonly SetupStage[];
  elapsed: string | undefined;
}) {
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
      {/* Skipped, not cancelled: a dash, not a strike. */}
      <Match when={stage.state === 'skipped'}>
        <MinusIcon
          aria-hidden="true"
          class="size-3.5 shrink-0 text-ink-extra-muted"
        />
      </Match>
    </Switch>
  );

  return (
    <ol
      id={props.id}
      aria-label={t('computers.setupProgressLabel')}
      class="flex flex-col gap-1.5 text-sm"
    >
      <For each={props.stages}>
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
              <span class="min-w-0 flex-1">{stage.label}</span>
              <Show when={stage.state === 'current' && props.elapsed}>
                {(time) => (
                  <span class="shrink-0 text-xs tabular-nums text-ink-muted">
                    {time()}
                  </span>
                )}
              </Show>
            </span>
            <Show when={stage.detail}>
              {(detail) => (
                <span class="pl-5.5 text-xs text-ink-muted text-pretty">
                  {detail()}
                </span>
              )}
            </Show>
          </li>
        )}
      </For>
    </ol>
  );
}

/**
 * The setup dialog's header: the step bar, and beside it one line for the
 * setup carrying on behind every step ("Starting up · 0:24") that expands to
 * the full list. A setup that stopped replaces the line with one banner:
 * why, Retry setup, and what a retry costs behind Details.
 */
export function SetupProgressHeader(props: {
  /** The step bar, which leads the header's first line. */
  steps: JSX.Element;
  computer: ComputerStatus;
  signIn: SignInPlan;
  connected: boolean;
  signedIn: boolean;
  /** Setup still has a stage to go, so the line is worth showing. */
  showProgress: boolean;
  /** The list is open; the dialog owns it so it stays open across steps. */
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** Sets a failed computer up again. */
  onRetry: () => void;
  retrying: boolean;
}) {
  const listId = createUniqueId();
  const detailsId = createUniqueId();
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  const elapsed = useSetupElapsed(() => props.computer);
  const stages = () =>
    setupStages(props.computer, {
      signIn: props.signIn,
      connected: props.connected,
      signedIn: props.signedIn,
    });
  const failure = () => setupFailure(props.computer, stages());
  const line = () =>
    props.showProgress && !failure()
      ? setupProgressLine(props.computer, stages(), elapsed())
      : undefined;

  return (
    <div class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        {props.steps}
        <Show when={line()}>
          {(text) => (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="-mr-2"
              aria-expanded={props.expanded}
              aria-controls={listId}
              tooltip={t('computers.showSetupProgress')}
              onClick={() => props.onExpandedChange(!props.expanded)}
            >
              <Spinner size="sm" decorative class="size-3.5" />
              <span class="tabular-nums">{text()}</span>
              <CaretDownIcon
                aria-hidden="true"
                class={cn(
                  'size-3.5 shrink-0 text-ink-muted transition-transform',
                  props.expanded && 'rotate-180'
                )}
              />
            </Button>
          )}
        </Show>
      </div>
      <Show when={line() && props.expanded}>
        <SetupProgressList id={listId} stages={stages()} elapsed={elapsed()} />
      </Show>
      <Show when={failure()}>
        {(stopped) => (
          <FailureNotice
            class="py-3"
            actions={
              <>
                <Show when={stopped().details}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-expanded={detailsOpen()}
                    aria-controls={detailsId}
                    onClick={() => setDetailsOpen(!detailsOpen())}
                  >
                    {t('computers.setupFailureDetails')}
                    <CaretDownIcon
                      aria-hidden="true"
                      class={cn(
                        'size-3.5 shrink-0 text-ink-muted transition-transform',
                        detailsOpen() && 'rotate-180'
                      )}
                    />
                  </Button>
                </Show>
                <Show when={stopped().retryable}>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={props.retrying}
                    onClick={() => props.onRetry()}
                  >
                    {t('computers.retrySetup')}
                  </Button>
                </Show>
              </>
            }
            below={
              <Show when={detailsOpen() && stopped().details}>
                {(details) => (
                  <p id={detailsId} class="text-xs text-ink-muted text-pretty">
                    {details()}
                  </p>
                )}
              </Show>
            }
          >
            {stopped().message}
          </FailureNotice>
        )}
      </Show>
    </div>
  );
}
