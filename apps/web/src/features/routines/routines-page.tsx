import { useViewControlHotkeys } from '@app/components/view-shell';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { modelLabel } from '@core/component/AI/constant/model-label';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { Show, Suspense } from 'solid-js';
import { createAgentRosterSource } from '../agents-view/queries/agent-roster-source';
import { getErrorMessage } from './core/routine-draft';
import { createRoutineListSource } from './queries/routine-sources';
import { RoutineDetail } from './routine-detail';
import { routineContent, routineIdFromContent } from './routine-navigation';
import { RoutinesListView } from './views/routines-list';

function RoutinesContent() {
  const userId = useUserId();
  const layout = useSplitLayout();
  const panel = useSplitPanelOrThrow();
  const selectedId = () => routineIdFromContent(panel.handle.content());
  const open = (id?: string) =>
    layout.openWithSplit(routineContent(id), {
      handle: panel.handle,
      activate: true,
      search: {},
    });
  let searchInput: HTMLInputElement | undefined;
  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: () => panel.isPanelActive() && !selectedId(),
    search: {
      description: 'Search routines',
      run: () => {
        searchInput?.focus();
        searchInput?.select();
        return true;
      },
    },
  });
  const roster = createAgentRosterSource();
  const source = createRoutineListSource((error) =>
    toast.alert('Could not update routine', { subtext: getErrorMessage(error) })
  );
  function create() {
    layout.popoverSplit({
      type: 'component',
      id: 'routine-compose',
      params: {
        onCreated: (id: string) => open(id),
      },
    });
  }
  return (
    <Show
      when={selectedId()}
      keyed
      fallback={
        <RoutinesListView
          source={source}
          userId={userId}
          targetLabel={(target) =>
            target.kind === 'agent'
              ? (roster.roster().find((agent) => agent.botId === target.agentId)
                  ?.name ?? 'Agent')
              : modelLabel(target.model)
          }
          targetModel={(target) =>
            target.kind === 'agent'
              ? (target.modelOverride ??
                roster.roster().find((agent) => agent.botId === target.agentId)
                  ?.defaultModel)
              : target.model
          }
          searchRef={(input) => (searchInput = input)}
          onCreate={create}
          onOpen={(id) => open(id)}
        />
      }
    >
      {(id) => (
        <RoutineDetail
          scheduleId={id}
          onBack={() => open()}
          onOpen={(id) => open(id)}
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
