import {
  ListSortDropdown,
  SearchBar,
  useViewControlHotkeys,
  ViewShell,
} from '@app/components/view-shell';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Show, Suspense } from 'solid-js';
import { DriveBreadcrumbsOutlet } from '../components/DriveBreadcrumbs';
import { useDriveView } from '../context/drive-context';
import { driveLocationLabel } from '../core/location-label';
import { DRIVE_SORT_OPTIONS } from '../core/types';
import { DriveCreateMenu } from '../drive-create-menu';
import { DriveFilterMenu } from './drive-filter-menu';
import { DriveMobileTabs } from './drive-mobile-tabs';

export function DriveHeader() {
  const { state, sidebar } = useDriveView();

  const title = () =>
    driveLocationLabel(state.value().location, sidebar.folders());

  const isRecent = () => {
    const location = state.value().location;

    return location.kind === 'tab' && location.tab === 'recent';
  };

  const panel = useSplitPanelOrThrow();

  let searchInput: HTMLInputElement | undefined;

  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: () => panel.isPanelActive() && !isTouchDevice(),
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
      <ViewShell.TopBar>
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
          <Show
            when={isTouchDevice()}
            fallback={
              <>
                <div class="hidden min-w-0 items-center gap-2 @max-[720px]/view-shell:flex">
                  <h1 class="min-w-0 truncate text-xl font-semibold tracking-[-0.03em] text-ink">
                    {title()}
                  </h1>
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
                        options={DRIVE_SORT_OPTIONS}
                      />
                    </Show>
                    <Show when={state.value().location.kind === 'tab'}>
                      <Suspense>
                        <DriveFilterMenu />
                      </Suspense>
                    </Show>
                  </div>
                </div>
              </>
            }
          >
            <DriveMobileTabs />
          </Show>
        </div>
      </ViewShell.Header>
    </>
  );
}
