import { useViewTabHotkeys, ViewSidebar } from '@app/components/view-shell';
import { ViewFavorites } from '@app/features/favorites/view-favorites';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import CheckSquareIcon from '@phosphor/check-square.svg';
import ListChecksIcon from '@phosphor/list-checks.svg';
import NoteIcon from '@phosphor/note-pencil.svg';
import PlusIcon from '@phosphor/plus.svg';
import { Button } from '@ui';
import { For } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { useTasksView } from '../tasks-view-context';
import type { TaskTab } from '../types';
import { TasksControls } from './TasksControls';

const TABS = [
  { id: 'my-tasks', label: 'My Tasks', icon: CheckSquareIcon },
  { id: 'team-tasks', label: 'All Tasks', icon: ListChecksIcon },
  { id: 'created-by-me', label: 'Created by me', icon: NoteIcon },
] satisfies { id: TaskTab; label: string; icon: typeof NoteIcon }[];

export function TasksNavigation(props: { onNavigate?: () => void }) {
  const { state, setTab } = useTasksView();
  return (
    <ViewSidebar.Nav aria-label="Task views">
      <For each={TABS}>
        {(item) => (
          <ViewSidebar.Item
            title={item.label}
            active={state.tab === item.id}
            class="h-9 shrink-0 gap-3 rounded-xl px-3 text-sm font-normal"
            onClick={() => {
              setTab(item.id);
              props.onNavigate?.();
            }}
          >
            <Dynamic
              component={item.icon}
              class="size-4 shrink-0 text-ink-muted"
            />
            <span class="truncate">{item.label}</span>
          </ViewSidebar.Item>
        )}
      </For>
    </ViewSidebar.Nav>
  );
}

export function TasksSidebar() {
  const layout = useSplitLayout();
  const panel = useSplitPanelOrThrow();
  const { state, setTab } = useTasksView();
  useViewTabHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    ids: () => TABS.map((tab) => tab.id),
    activeId: () => state.tab,
    setActiveId: setTab,
  });
  return (
    <ViewSidebar.Root aria-label="Tasks navigation">
      <ViewSidebar.Header>
        <ViewSidebar.Title>Tasks</ViewSidebar.Title>
      </ViewSidebar.Header>
      <div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
        <Button
          variant="ghost"
          class="mb-6 h-10 shrink-0 justify-start gap-3 rounded-xl border-edge-muted bg-ink/4 px-3 text-ink"
          onClick={() =>
            layout.popoverSplit({ type: 'component', id: 'task-compose' })
          }
        >
          <PlusIcon class="size-4" /> New task
        </Button>
        <TasksNavigation />
        <ViewFavorites view="tasks" class="mt-6 shrink-0" />
        <div class="mt-6 flex min-h-0 flex-1 flex-col">
          <TasksControls tagsOnly />
        </div>
      </div>
    </ViewSidebar.Root>
  );
}
