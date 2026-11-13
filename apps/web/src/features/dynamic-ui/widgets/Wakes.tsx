import { t } from '@app/lib/i18n';
import { usePending } from '@app/observability/flow';
import { useAgentWakesQuery } from '@queries/agent-wakes/wakes';
import type { AgentWake } from '@service-agent-harness/agent-wakes';
import { cn } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { TEXT } from '../tokens';
import type { WidgetOf } from '../view';
import {
  formatCost,
  formatDuration,
  triggerLabel,
  type WakeState,
  wakeDuration,
  wakeState,
} from './wakes/format';
import { AgentDashboardsGate } from './wakes/Gate';
import { Notice } from './wakes/Notice';
import { TraceWaterfall } from './wakes/TraceWaterfall';

export type WakesProps = Omit<WidgetOf<'wakes'>, 'type'>;

const STATE_DOT: Record<WakeState, string> = {
  running: 'bg-accent animate-pulse',
  lost: 'bg-ink-muted',
  ok: 'bg-success',
  failed: 'bg-failure',
  timeout: 'bg-warning',
  cancelled: 'bg-edge',
};

function stateLabel(state: WakeState): string {
  switch (state) {
    case 'running':
      return t('dynamicUi.wakeRunning');
    case 'lost':
      return t('dynamicUi.wakeLost');
    case 'ok':
      return t('dynamicUi.wakeOk');
    case 'failed':
      return t('dynamicUi.wakeFailed');
    case 'timeout':
      return t('dynamicUi.wakeTimeout');
    case 'cancelled':
      return t('dynamicUi.wakeCancelled');
  }
}

/**
 * An agent account's wakes, newest first: one row each with what woke it,
 * whether it still runs, how long it took, its cost when known and what came
 * of it. A row opens that wake's trace beneath it.
 */
export function Wakes(props: WakesProps) {
  return (
    <AgentDashboardsGate>
      <WakeList {...props} />
    </AgentDashboardsGate>
  );
}

function WakeList(props: WakesProps) {
  const wakes = useAgentWakesQuery(
    () => props.agentId,
    () => ({
      status: props.status,
      limit: props.limit,
    })
  );
  usePending('pane.wakes', () => wakes.isPending);

  // Running wakes show a duration that grows; nothing ticks once none runs.
  const [now, setNow] = createSignal(Date.now());
  const running = createMemo(
    () =>
      wakes.data?.wakes.some((wake) => wakeState(wake, now()) === 'running') ??
      false
  );
  createEffect(() => {
    if (!running()) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(tick));
  });

  return (
    <section
      class="flex w-full min-w-0 flex-col gap-2"
      aria-label={props.title ?? t('dynamicUi.wakesTitle')}
    >
      <Show when={props.title}>
        {(title) => <h3 class="text-ink text-sm font-semibold">{title()}</h3>}
      </Show>
      <Switch>
        <Match when={wakes.isPending}>
          <div class={cn('text-xs', TEXT.secondary)}>
            {t('dynamicUi.wakesLoading')}
          </div>
        </Match>
        <Match when={wakes.isError}>
          <Notice>{t('dynamicUi.wakesFailed')}</Notice>
        </Match>
        <Match when={wakes.isSuccess && wakes.data === null}>
          <Notice>{t('dynamicUi.wakesNoAccess')}</Notice>
        </Match>
        <Match when={wakes.data?.wakes.length === 0}>
          <Notice>{t('dynamicUi.wakesEmpty')}</Notice>
        </Match>
        <Match when={wakes.data}>
          {(page) => (
            <ul class="border-edge-muted flex min-w-0 flex-col rounded border">
              <For each={page().wakes}>
                {(wake) => (
                  <WakeRow wake={wake} agentId={props.agentId} now={now()} />
                )}
              </For>
            </ul>
          )}
        </Match>
      </Switch>
    </section>
  );
}

function WakeRow(props: { wake: AgentWake; agentId: string; now: number }) {
  const [open, setOpen] = createSignal(false);
  const state = () => wakeState(props.wake, props.now);
  const record = () => props.wake.record;
  const cost = () => record().usage?.costUsd ?? undefined;
  const outcome = () => record().outcome ?? undefined;

  return (
    <li class="border-edge-muted min-w-0 border-b last:border-b-0">
      <button
        type="button"
        class="hover:bg-hover flex w-full min-w-0 items-center gap-2 px-2 py-1.5 text-left text-xs"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        <span
          class={cn('size-2 shrink-0 rounded-full', STATE_DOT[state()])}
          title={stateLabel(state())}
          aria-label={stateLabel(state())}
        />
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="text-ink truncate font-medium">
            {record().trigger.summary ?? triggerLabel(props.wake)}
          </span>
          <span class={cn('truncate', TEXT.tertiary)}>
            {record().system}
            <Show when={record().trigger.summary}>
              {' · '}
              {triggerLabel(props.wake)}
            </Show>
            <Show when={outcome()}>
              {(classified) => (
                <>
                  {' '}
                  →{' '}
                  <span
                    class={cn(
                      classified().check === 'contradicted' && 'text-warning'
                    )}
                  >
                    {classified().name}
                  </span>
                </>
              )}
            </Show>
          </span>
        </span>
        <span class={cn('shrink-0 tabular-nums', TEXT.secondary)}>
          {formatDuration(wakeDuration(props.wake, props.now))}
        </span>
        <Show when={cost()}>
          {(usd) => (
            <span
              class={cn(
                'hidden w-14 shrink-0 text-right tabular-nums sm:inline',
                TEXT.secondary
              )}
            >
              {formatCost(usd())}
            </span>
          )}
        </Show>
        <span
          class={cn('hidden w-16 shrink-0 text-right sm:inline', TEXT.tertiary)}
        >
          {new Date(record().startedAt).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </span>
      </button>
      <Show when={open()}>
        <div class="px-2 pb-2">
          <Show
            when={props.wake.traceUpdatedAt}
            fallback={<Notice>{t('dynamicUi.wakeNoTrace')}</Notice>}
          >
            <TraceWaterfall agentId={props.agentId} wakeId={record().wake} />
          </Show>
        </div>
      </Show>
    </li>
  );
}
