import { useSplitLayout } from '@components/app/split-layout/layout';
import { modelLabel } from '@core/component/AI/constant/model-label';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { getDisplayName, tryMacroId } from '@core/user';
import { isClaimActive } from '@queries/agent-schedule/entities';
import { useTeamRoutinesQuery } from '@queries/agent-schedule/routines';
import {
  useSchedulesQuery,
  useSetScheduleEnabledMutation,
} from '@queries/agent-schedule/schedules';
import { createMemo, createSignal, Suspense } from 'solid-js';
import { createAgentRosterSource } from '../agents-view/queries/agent-roster-source';
import { setAutomationComposerOpen } from '../block-automation/component/AutomationComposer';
import {
  createEmptyDraft,
  describeSchedule,
  draftFromSchedule,
  getDefaultTimezone,
  getErrorMessage,
} from '../block-automation/component/automationUtils';
import {
  routineSearch,
  routineSearchCodec,
} from '../block-automation/routine-search';
import { saveAutomationComposerDraft } from '../block-automation/util/automationComposerStorage';
import { RoutinesList } from './components/routines-list';
import type { RoutineRow, RoutineTemplate } from './core/types';

function RoutinesContent() {
  const userId = useUserId();
  const layout = useSplitLayout();
  const [scope, setScope] = createSignal<'mine' | 'team'>('mine');
  const mine = useSchedulesQuery(() => true);
  const team = useTeamRoutinesQuery(() => scope() === 'team');
  const roster = createAgentRosterSource();
  const query = () => (scope() === 'mine' ? mine : team);
  const rows = createMemo<RoutineRow[]>(() => {
    const source = query();
    const data = source.isSuccess || source.isError ? (source.data ?? []) : [];
    return data
      .toSorted((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .flatMap((routine) => {
        if (!routine.id) return [];
        const draft = draftFromSchedule(routine);
        const target = draft?.target;
        const running = isClaimActive(routine.claimed);
        const completed =
          draft?.frequency === 'once' && !routine.next_run_at && !running;
        return [
          {
            id: routine.id,
            name: routine.name,
            creator:
              routine.owner === userId()
                ? 'You'
                : getDisplayName(tryMacroId(routine.owner)),
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
  function create(template?: RoutineTemplate) {
    if (template)
      saveAutomationComposerDraft({
        ...createEmptyDraft(),
        name: template.name,
        prompt: template.prompt,
        daysOfWeek: template.days,
        time: template.time,
      });
    setAutomationComposerOpen(true, false);
  }
  return (
    <RoutinesList
      rows={rows()}
      scope={scope()}
      onScope={setScope}
      loading={query().isPending}
      error={query().isError}
      onRetry={() => void query().refetch()}
      onCreate={create}
      onOpen={(id, history) =>
        layout.openWithSplit(
          { type: 'automation', id },
          {
            search: {
              [routineSearch.namespace]: routineSearchCodec.serialize({
                tab: history ? 'history' : 'settings',
              }),
            },
          }
        )
      }
      pendingId={toggle.isPending ? toggle.variables?.scheduleId : undefined}
      onToggle={(row) =>
        toggle.mutate({ scheduleId: row.id, enabled: !row.enabled })
      }
    />
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
