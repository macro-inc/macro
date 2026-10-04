import { useViewControlHotkeys } from '@app/components/view-shell';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { modelLabel } from '@core/component/AI/constant/model-label';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { isClaimActive } from '@queries/agent-schedule/entities';
import {
  useSchedulesQuery,
  useSetScheduleEnabledMutation,
} from '@queries/agent-schedule/schedules';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  Show,
  Suspense,
} from 'solid-js';
import { createAgentRosterSource } from '../agents-view/queries/agent-roster-source';
import { RoutineDetail } from '../block-automation/component/Automation';
import {
  describeSchedule,
  draftFromSchedule,
  getDefaultTimezone,
  getErrorMessage,
} from '../block-automation/component/automationUtils';
import { hasOnlyScheduledTriggers } from '../block-automation/core/routine-triggers';
import { RoutinesList } from './components/routines-list';
import type { RoutineRow } from './core/types';

function RoutinesContent() {
  const userId = useUserId();
  const layout = useSplitLayout();
  const panel = useSplitPanelOrThrow();
  const [selected, setSelected] = createSignal<{
    id: string;
    tab: 'settings' | 'history';
  }>();
  let searchInput: HTMLInputElement | undefined;
  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: () => panel.isPanelActive() && !selected(),
    search: {
      description: 'Search routines',
      run: () => {
        searchInput?.focus();
        searchInput?.select();
        return true;
      },
    },
  });
  createEffect(
    on(
      () => {
        const content = panel.handle.content();
        return content.type === 'component'
          ? content.params?.agentPageRequest
          : undefined;
      },
      () => {
        const content = panel.handle.content();
        const id =
          content.type === 'component' ? content.params?.routineId : undefined;
        setSelected(
          typeof id === 'string' ? { id, tab: 'settings' } : undefined
        );
        if (id !== undefined) {
          panel.handle.updateCurrentEntry((current) => {
            if (current.type !== 'component') return current;
            const { routineId: _routineId, ...params } = current.params ?? {};
            return { ...current, params };
          });
        }
      }
    )
  );
  const query = useSchedulesQuery(() => true);
  const roster = createAgentRosterSource();
  const rows = createMemo<RoutineRow[]>(() => {
    const data = query.isSuccess || query.isError ? (query.data ?? []) : [];
    return data
      .toSorted((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .flatMap((routine) => {
        if (!routine.id) return [];
        const draft = draftFromSchedule(routine);
        const target = draft?.target;
        const running = isClaimActive(routine.claimed);
        const completed =
          hasOnlyScheduledTriggers(draft?.triggers) &&
          !routine.next_run_at &&
          !running;
        return [
          {
            id: routine.id,
            name: routine.name,
            creator: 'You',
            createdAt: routine.created_at,
            target:
              target?.kind === 'agent'
                ? (roster
                    .roster()
                    .find((agent) => agent.botId === target.agentId)?.name ??
                  'Agent')
                : target?.kind === 'model'
                  ? modelLabel(target.model)
                  : 'Agent',
            schedule: draft
              ? describeSchedule(draft, getDefaultTimezone())
              : 'Event triggered',
            status: running
              ? 'Running'
              : completed
                ? 'Completed'
                : routine.enabled
                  ? 'Active'
                  : 'Paused',
            enabled: routine.enabled,
            editable: routine.owner === userId(),
          },
        ];
      });
  });
  const toggle = useSetScheduleEnabledMutation({
    onError: (error) =>
      toast.alert('Could not update routine', {
        subtext: getErrorMessage(error),
      }),
  });
  function create() {
    layout.popoverSplit({
      type: 'component',
      id: 'routine-compose',
      params: {
        onCreated: (id: string) => setSelected({ id, tab: 'settings' }),
      },
    });
  }
  return (
    <Show
      when={selected()}
      keyed
      fallback={
        <RoutinesList
          searchRef={(input) => (searchInput = input)}
          rows={rows()}
          loading={query.isPending}
          error={query.isError}
          onRetry={() => void query.refetch()}
          onCreate={create}
          onOpen={(id, history) =>
            setSelected({ id, tab: history ? 'history' : 'settings' })
          }
          pendingId={
            toggle.isPending ? toggle.variables?.scheduleId : undefined
          }
          onToggle={(row) =>
            toggle.mutate({ scheduleId: row.id, enabled: !row.enabled })
          }
        />
      }
    >
      {(routine) => (
        <RoutineDetail
          scheduleId={routine.id}
          initialTab={routine.tab}
          onBack={() => setSelected(undefined)}
          onOpen={(id) => setSelected({ id, tab: 'settings' })}
        />
      )}
    </Show>
  );
}
export function RoutinesPage() {
  return (
    <Suspense
      fallback={<div class="p-6 text-sm text-ink-muted">Loading routines…</div>}
    >
      <RoutinesContent />
    </Suspense>
  );
}
