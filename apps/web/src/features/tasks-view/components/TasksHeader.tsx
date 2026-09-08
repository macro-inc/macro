import { SearchBar, useViewControlHotkeys } from '@app/components/view-shell';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import MenuIcon from '@phosphor/list.svg';
import PlusIcon from '@phosphor/plus.svg';
import { Button, Dropdown } from '@ui';
import { createSignal } from 'solid-js';
import { useTasksView } from '../tasks-view-context';
import { TasksControls } from './TasksControls';
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

  return (
    <div class="flex min-w-0 flex-col">
      <SplitPanel.ControlGroup class="hidden px-2 pb-2 @max-[720px]/view-shell:flex">
        <SplitPanel.CloseButton />
        <SplitPanel.BackButton />
        <SplitPanel.ForwardButton />
      </SplitPanel.ControlGroup>

      <div class="mb-4 hidden min-w-0 items-center gap-2 @max-[720px]/view-shell:flex">
        <Dropdown
          open={navigationOpen()}
          onOpenChange={setNavigationOpen}
          placement="bottom-start"
        >
          <Dropdown.Trigger
            variant="ghost"
            size="sm"
            square
            class="size-8 shrink-0 rounded-full"
            aria-label="Open Tasks navigation"
          >
            <MenuIcon class="size-4" />
          </Dropdown.Trigger>
          <Dropdown.Content class="w-72 rounded-2xl p-2">
            <div class="rounded-xl bg-menu">
              <TasksNavigation onNavigate={() => setNavigationOpen(false)} />
            </div>
          </Dropdown.Content>
        </Dropdown>
        <h1 class="min-w-0 truncate text-xl font-semibold tracking-[-0.03em] text-ink">
          Tasks
        </h1>
        <Button
          type="button"
          variant="cta"
          size="md"
          class="ml-auto rounded-lg px-3"
          onClick={createTask}
        >
          <PlusIcon class="size-4 shrink-0" />
          New
        </Button>
      </div>

      <div class="flex min-w-0 items-center justify-between gap-3">
        <SearchBar
          ref={(element) => (searchInput = element)}
          label="Search tasks"
          value={state.search}
          hotkey="cmd+f"
          onValueChange={(search) => setState('search', search)}
          placeholder="Search tasks"
          class="max-w-md flex-1"
        />
        <TasksControls />
      </div>
    </div>
  );
}
