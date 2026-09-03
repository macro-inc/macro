import { SearchBar, useViewControlHotkeys } from '@app/components/view-shell';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CaretDownIcon from '@phosphor/caret-down.svg';
import PlusIcon from '@phosphor/plus.svg';
import { Button, Dropdown } from '@ui';
import { createSignal, Show } from 'solid-js';
import { TASK_TABS } from '../constants';
import { useTasksView } from '../tasks-view-context';
import { TasksControls } from './TasksControls';
import { TasksMobileTabs } from './TasksMobileTabs';
import { TasksNavigation } from './TasksSidebar';

export function TasksHeader() {
  const panel = useSplitPanelOrThrow();
  const layout = useSplitLayout();
  const { state, setState } = useTasksView();
  const [navigationOpen, setNavigationOpen] = createSignal(false);
  let searchInput: HTMLInputElement | undefined;

  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: () => panel.isPanelActive() && !isTouchDevice(),
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

  const selectedTabLabel = () =>
    TASK_TABS.find((tab) => tab.id === state.tab)?.label;

  return (
    <div class="flex min-w-0 flex-col">
      <Show
        when={isTouchDevice()}
        fallback={
          <>
            <SplitPanel.ControlGroup class="hidden pb-2 @max-[720px]/view-shell:flex">
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
                <h1 class="min-w-0">
                  <Dropdown.Trigger
                    variant="ghost"
                    size="sm"
                    class="h-auto min-w-0 max-w-full gap-1 rounded-lg px-2 py-1 text-xl font-semibold tracking-[-0.03em] text-ink"
                    aria-label={`Select task view: ${selectedTabLabel()}`}
                  >
                    <span class="truncate">{selectedTabLabel()}</span>
                    <CaretDownIcon class="size-3.5 shrink-0 text-ink-muted" />
                  </Dropdown.Trigger>
                </h1>
                <Dropdown.Content class="w-72 rounded-2xl p-2">
                  <div class="rounded-xl bg-menu">
                    <TasksNavigation
                      onNavigate={() => setNavigationOpen(false)}
                    />
                  </div>
                </Dropdown.Content>
              </Dropdown>
              <Button
                type="button"
                variant="cta"
                size="md"
                class="ml-auto"
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
          </>
        }
      >
        <TasksMobileTabs />
      </Show>
    </div>
  );
}
