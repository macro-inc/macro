import { useViewControlHotkeys } from '@app/components/view-shell';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { Show, Suspense } from 'solid-js';
import { getErrorMessage } from './core/routine-draft';
import { createRoutineListSource } from './queries/routine-sources';
import { createRoutineTargetDisplay } from './queries/routine-target-display';
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
  let focusSearch: (() => void) | undefined;
  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: () => panel.isPanelActive() && !selectedId(),
    search: {
      description: 'Search routines',
      run: () => {
        focusSearch?.();
        return true;
      },
    },
  });
  const display = createRoutineTargetDisplay();
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
          targetLabel={display.targetLabel}
          registerSearchFocus={(focus) => (focusSearch = focus)}
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
