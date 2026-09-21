import { setAutomationComposerOpen } from '@app/features/block-automation/component/AutomationComposer';
import { SettingsPage } from '@app/features/settings/primitives';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { describeCron, parseCron } from '@core/util/cron';
import { useSchedulesQuery } from '@queries/agent-schedule/schedules';
import { Button } from '@ui';
import { For, Match, Switch } from 'solid-js';

/** Mounted inside the Agents workspace's page-local Suspense boundary. */
export function RoutinesPage() {
  const schedules = useSchedulesQuery(() => true);
  const layout = useSplitLayout();
  const routines = () => (schedules.isSuccess ? schedules.data : []);

  return (
    <SettingsPage
      title="Routines"
      description="Schedule recurring work for your agents."
      actions={
        <Button onClick={() => setAutomationComposerOpen(true)}>
          New routine
        </Button>
      }
    >
      <Switch>
        <Match when={schedules.isPending}>
          <p role="status" class="text-sm text-ink-muted">
            Loading routines…
          </p>
        </Match>
        <Match when={schedules.isError}>
          <div class="flex items-center gap-3 text-sm text-ink-muted">
            <p>Could not load routines.</p>
            <Button variant="ghost" onClick={() => void schedules.refetch()}>
              Retry
            </Button>
          </div>
        </Match>
        <Match when={routines().length === 0}>
          <p class="py-8 text-center text-sm text-ink-muted">
            No routines yet. Create a routine to run work on a schedule.
          </p>
        </Match>
        <Match when={true}>
          <div class="divide-y divide-edge-muted overflow-hidden rounded-xl border border-edge-muted">
            <For each={routines()}>
              {(routine) => (
                <button
                  type="button"
                  disabled={!routine.id}
                  class="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-hover focus-visible:bg-hover"
                  onClick={(event) => {
                    if (!routine.id) return;
                    layout.openWithSplit(
                      { type: 'automation', id: routine.id },
                      { activate: true, preferNewSplit: event.shiftKey }
                    );
                  }}
                >
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm text-ink">
                      {routine.name}
                    </span>
                    <span class="text-xs text-ink-muted">
                      {describeCron(
                        parseCron(routine.schedule),
                        routine.timezone
                      )}
                    </span>
                  </span>
                  <span class="text-xs text-ink-muted">
                    {routine.enabled ? 'Active' : 'Paused'}
                  </span>
                </button>
              )}
            </For>
          </div>
        </Match>
      </Switch>
    </SettingsPage>
  );
}
