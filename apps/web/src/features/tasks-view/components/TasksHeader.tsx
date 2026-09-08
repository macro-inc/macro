import { SearchBar, useViewControlHotkeys } from '@app/components/view-shell';
import { PreviewButton } from '@components/app/split-layout/components/PreviewButton';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import MenuIcon from '@phosphor/list.svg';
import PlusIcon from '@phosphor/plus.svg';
import { Button, Dropdown } from '@ui';
import { createSignal } from 'solid-js';
import { useTasksView } from '../tasks-view-context';
import { TasksNavigation } from './TasksSidebar';

export function TasksHeader() {
  const panel = useSplitPanelOrThrow();
  const layout = useSplitLayout();
  const { state, setState } = useTasksView();
  const [navigationOpen, setNavigationOpen] = createSignal(false);
  let searchInput: HTMLInputElement | undefined;

  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    search: {
      description: 'Search tasks',
      run: () => {
        searchInput?.focus();
        searchInput?.select();
        return true;
      },
    },
  });

  const createTask = () => {
    layout.popoverSplit({ type: 'component', id: 'task-compose' });
  };

  const title = () =>
    state.tab === 'my-tasks'
      ? 'My Tasks'
      : state.tab === 'team-tasks'
        ? 'All Tasks'
        : 'Created by me';
  return (
    <header class="flex h-12 shrink-0 items-center gap-3  px-4">
      <div class="hidden @max-[720px]/view-shell:block">
        <Dropdown
          open={navigationOpen()}
          onOpenChange={setNavigationOpen}
          placement="bottom-start"
        >
          <Dropdown.Trigger
            variant="ghost"
            size="sm"
            square
            aria-label="Open Tasks navigation"
          >
            <MenuIcon class="size-4" />
          </Dropdown.Trigger>
          <Dropdown.Content class="w-72 rounded-xl p-2">
            <TasksNavigation onNavigate={() => setNavigationOpen(false)} />
            <Button variant="ghost" onClick={createTask}>
              <PlusIcon class="size-4" />
              New task
            </Button>
          </Dropdown.Content>
        </Dropdown>
      </div>
      <h2 class="min-w-0 truncate text-sm font-semibold text-ink">{title()}</h2>
      <div class="ml-auto min-w-0 max-w-80 flex-1">
        <SearchBar
          ref={(element) => (searchInput = element)}
          label="Search tasks"
          value={state.search}
          hotkey="cmd+f"
          onValueChange={(search) => setState('search', search)}
          placeholder="Search tasks"
          class="h-9 rounded-lg border border-edge-muted bg-transparent"
        />
      </div>
      <PreviewButton iconOnly class="size-8 rounded-lg" />
    </header>
  );
}
