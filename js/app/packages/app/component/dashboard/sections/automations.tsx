import { globalSplitManager } from '@app/signal/splitLayout';
import { setAutomationComposerOpen } from '@block-automation/component';
import type { AutomationEntity } from '@entity';
import { formatDateAndTime } from '@entity/utils/timestamp';
import { useAutomationEntities } from '@queries/agent-schedule/entities';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import PlusIcon from '@phosphor/plus.svg';
import RobotIcon from '@phosphor/robot.svg';
import { Button, Layer } from '@ui';
import { createMemo, For, Match, Show, Switch } from 'solid-js';

function AutomationStatus(props: { automation: AutomationEntity }) {
  return (
    <Switch>
      <Match when={props.automation.isRunning}>
        <span class="flex items-center gap-1.5 rounded-md bg-accent-bg px-1.5 py-1 text-xxs font-semibold text-accent">
          <span class="size-1.5 animate-pulse rounded-full bg-accent" />
          Running
        </span>
      </Match>
      <Match when={!props.automation.enabled}>
        <span class="rounded-md bg-hover px-1.5 py-1 text-xxs font-semibold text-ink-muted">
          Paused
        </span>
      </Match>
      <Match when={true}>
        <span class="rounded-md bg-hover px-1.5 py-1 text-xxs font-semibold text-ink-muted">
          Active
        </span>
      </Match>
    </Switch>
  );
}

function AutomationRow(props: { automation: AutomationEntity }) {
  const open = (event: MouseEvent) => {
    globalSplitManager()?.openWithSplit(
      { type: 'automation', id: props.automation.id },
      {
        activate: true,
        referredFrom: 'dashboard',
        preferNewSplit: event.shiftKey,
      }
    );
  };

  return (
    <button
      class="group relative flex w-full items-center gap-3 rounded-lg p-2.5 text-left transition hover:bg-active/60 hover:ring hover:ring-edge hover:ring-inset focus:outline-none focus-visible:bg-active/60 focus-visible:ring focus-visible:ring-edge focus-visible:ring-inset"
      onClick={open}
    >
      <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-hover text-ink-muted transition group-hover:text-ink">
        <RobotIcon class="size-4" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-center gap-2">
          <h3 class="truncate text-sm font-medium text-ink">
            {props.automation.name}
          </h3>
          <AutomationStatus automation={props.automation} />
        </div>
        <p class="mt-0.5 truncate text-xs text-ink-muted">
          <Show
            when={props.automation.enabled && props.automation.nextRunAt}
            fallback={
              props.automation.enabled ? props.automation.cron : 'Not scheduled'
            }
          >
            {(nextRunAt) => <>Next run {formatDateAndTime(nextRunAt())}</>}
          </Show>
        </p>
      </div>
      <div class="pointer-events-none opacity-0 transition group-hover:opacity-100">
        <Layer depth={3}>
          <div class="flex size-8 items-center justify-center rounded-xl bg-hover text-ink-muted transition group-hover:text-ink">
            <ArrowRightIcon class="size-4" />
          </div>
        </Layer>
      </div>
    </button>
  );
}

export function AutomationsSection() {
  const automations = useAutomationEntities();
  const visibleAutomations = createMemo(() =>
    [...automations()]
      .sort((a, b) => {
        if (a.isRunning !== b.isRunning) return a.isRunning ? -1 : 1;
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
        const aNext = a.nextRunAt ? new Date(a.nextRunAt).getTime() : Infinity;
        const bNext = b.nextRunAt ? new Date(b.nextRunAt).getTime() : Infinity;
        return aNext - bNext;
      })
      .slice(0, 5)
  );

  const openAgents = (event: MouseEvent) => {
    globalSplitManager()?.openWithSplit(
      { type: 'component', id: 'agents' },
      {
        activate: true,
        referredFrom: 'dashboard',
        preferNewSplit: event.shiftKey,
      }
    );
  };

  return (
    <section>
      <Layer depth={2}>
        <div class="overflow-hidden rounded-2xl border border-edge-muted bg-surface">
          <div class="flex items-center justify-between gap-3 p-3">
            <div class="min-w-0">
              <h2 class="text-lg font-semibold tracking-tight text-ink">
                Automations
              </h2>
              <p class="mt-1 text-xxs text-ink-muted">
                Scheduled agents and recurring work
              </p>
            </div>
            <Button
              variant="base"
              size="sm"
              depth={3}
              class="h-8 shrink-0 rounded-lg bg-surface px-3"
              onClick={() => setAutomationComposerOpen(true, false)}
            >
              <PlusIcon class="size-3.5" />
              New
            </Button>
          </div>

          <Show
            when={visibleAutomations().length > 0}
            fallback={
              <div class="px-3 pb-3">
                <button
                  class="flex w-full flex-col items-center justify-center rounded-xl bg-hover/50 px-4 py-6 text-center transition hover:bg-active/60 hover:ring hover:ring-edge hover:ring-inset"
                  onClick={() => setAutomationComposerOpen(true, false)}
                >
                  <RobotIcon class="mb-3 size-6 text-ink-muted" />
                  <p class="text-sm font-medium text-ink">No automations yet</p>
                  <p class="mt-1 text-xs text-ink-muted">
                    Create a scheduled agent to handle recurring work.
                  </p>
                </button>
              </div>
            }
          >
            <div class="px-3 pb-3">
              <div class="space-y-1">
                <For each={visibleAutomations()}>
                  {(automation) => <AutomationRow automation={automation} />}
                </For>
              </div>
              <Button
                variant="ghost"
                size="sm"
                class="mt-2 w-full justify-center rounded-lg"
                onClick={openAgents}
              >
                View all automations
              </Button>
            </div>
          </Show>
        </div>
      </Layer>
    </section>
  );
}
