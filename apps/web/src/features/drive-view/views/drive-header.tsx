import {
  ListSortDropdown,
  SearchBar,
  SidebarActionRow,
  useViewControlHotkeys,
  ViewShell,
} from '@app/components/view-shell';
import { useSidebarSearchFocus } from '@app/components/view-shell/SidebarActionRow';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Show, Suspense } from 'solid-js';
import { DriveBreadcrumbsOutlet } from '../components/DriveBreadcrumbs';
import { useDriveView } from '../context/drive-context';
import { DRIVE_SORT_OPTIONS } from '../core/types';
import { DriveCreateMenu } from '../drive-create-menu';
import { DriveFilterMenu } from './drive-filter-menu';
import { DriveMobileTabs } from './drive-mobile-tabs';

export function DriveHeader() {
  const { state } = useDriveView();

  const isRecent = () => {
    const location = state.value().location;

    return location.kind === 'tab' && location.tab === 'recent';
  };

  return (
    <>
      <ViewShell.TopBar
        controls={
          <div class="flex min-w-0 items-center gap-2">
            <Show when={!isTouchDevice()}>
              <div class="flex shrink-0 items-center gap-1">
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
            </Show>
          </div>
        }
        workspaceActions
        class="h-12 gap-3 px-4 not-touch:pl-4 touch:flex touch:mt-[var(--safe-top,0px)]"
      >
        <h1 class="hidden min-w-0 truncate text-sm font-semibold text-ink @max-[720px]/view-shell:block">
          Drive
        </h1>
        <DriveBreadcrumbsOutlet
          aria-label="Drive location"
          class="min-w-0 @max-[720px]/view-shell:hidden"
        />
      </ViewShell.TopBar>
      <Show when={isTouchDevice()}>
        <ViewShell.Header class="py-2 touch:pt-2">
          <DriveMobileTabs />
        </ViewShell.Header>
      </Show>
    </>
  );
}

export function DrivePrimaryActions() {
  const { state } = useDriveView();
  const panel = useSplitPanelOrThrow();

  let searchInput: HTMLInputElement | undefined;
  const focusSearch = useSidebarSearchFocus(() => searchInput);

  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: () => panel.isPanelActive() && !isTouchDevice(),
    search: {
      description: 'Search Drive',

      run: () => {
        focusSearch();

        return true;
      },
    },
  });

  return (
    <SidebarActionRow
      title="Drive"
      onSearch={() => {
        focusSearch();
      }}
      search={
        <SearchBar
          ref={(element) => (searchInput = element)}
          label="Search Drive"
          placeholder="Search files"
          value={state.value().search}
          onValueChange={state.setSearch}
        />
      }
      create={() => <DriveCreateMenu presentation="toolbar" />}
    />
  );
}
