import {
  ListSortDropdown,
  SearchBar,
  useViewControlHotkeys,
  ViewShell,
} from '@app/components/view-shell';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CaretDownIcon from '@phosphor/caret-down.svg';
import { Dropdown } from '@ui';
import { createSignal, Show, Suspense } from 'solid-js';
import { DriveBreadcrumbsOutlet } from '../components/DriveBreadcrumbs';
import { useDriveView } from '../context/drive-context';
import { driveLocationLabel } from '../core/location-label';
import { DriveCreateMenu } from '../drive-create-menu';
import { DriveFilterMenu } from './drive-filter-menu';
import { DriveSidebarContent } from './drive-sidebar';

export function DriveHeader() {
  const { state, sidebar } = useDriveView();

  const title = () =>
    driveLocationLabel(state.value().location, sidebar.folders());

  const isRecent = () => {
    const location = state.value().location;

    return location.kind === 'tab' && location.tab === 'recent';
  };

  const panel = useSplitPanelOrThrow();

  const [navigationOpen, setNavigationOpen] = createSignal(false);

  let searchInput: HTMLInputElement | undefined;

  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    search: {
      description: 'Search Drive',

      condition: () => !state.projectId(),

      run: () => {
        searchInput?.focus();
        searchInput?.select();

        return true;
      },
    },
  });

  return (
    <>
      <ViewShell.TopBar class="touch:flex">
        <h1 class="hidden min-w-0 truncate text-sm font-semibold tracking-[-0.03em] text-ink @max-[720px]/view-shell:block">
          Drive
        </h1>
        <DriveBreadcrumbsOutlet
          aria-label="Drive location"
          class="@max-[720px]/view-shell:hidden"
        />
      </ViewShell.TopBar>
      <ViewShell.Header>
        <div class="flex min-w-0 flex-col gap-3">
          <div class="hidden min-w-0 items-center gap-2 @max-[720px]/view-shell:flex">
            <Show
              when={isTouchDevice()}
              fallback={
                <h1 class="min-w-0 truncate text-xl font-semibold tracking-[-0.03em] text-ink">
                  {title()}
                </h1>
              }
            >
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
                    aria-label={`Select Drive view: ${title()}`}
                  >
                    <span class="truncate">{title()}</span>
                    <CaretDownIcon class="size-3.5 shrink-0 text-ink-muted" />
                  </Dropdown.Trigger>
                </h1>
                <Dropdown.Content class="max-h-[70vh] w-72 overflow-auto rounded-2xl">
                  <Dropdown.Group class="gap-5 p-3">
                    <DriveSidebarContent
                      onNavigate={() => setNavigationOpen(false)}
                    />
                  </Dropdown.Group>
                </Dropdown.Content>
              </Dropdown>
            </Show>
            <div class="ml-auto shrink-0">
              <DriveCreateMenu />
            </div>
          </div>
          <div class="flex min-w-0 items-center justify-between gap-3">
            <Show when={!state.projectId()}>
              <SearchBar
                ref={(element) => {
                  searchInput = element;
                }}
                label="Search Drive"
                placeholder="Search files"
                value={state.value().search}
                onValueChange={state.setSearch}
                hotkey="cmd+f"
                class="max-w-md flex-1"
              />
            </Show>
            <div class="ml-auto flex shrink-0 items-center gap-2">
              <Show when={!isRecent()}>
                <ListSortDropdown
                  label="Sort files"
                  value={state.value().sort}
                  onChange={state.setSort}
                  options={[
                    { id: 'updated_at', label: 'Last modified' },
                    { id: 'created_at', label: 'Created' },
                    { id: 'viewed_at', label: 'Last viewed' },
                  ]}
                />
              </Show>
              <Show when={state.value().location.kind === 'tab'}>
                <Suspense>
                  <DriveFilterMenu />
                </Suspense>
              </Show>
            </div>
          </div>
        </div>
      </ViewShell.Header>
    </>
  );
}
