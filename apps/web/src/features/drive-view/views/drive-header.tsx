import {
  ListSortDropdown,
  useViewControlHotkeys,
  ViewShell,
} from '@app/components/view-shell';
import {
  ListHeader,
  ListHeaderSearch,
} from '@app/components/view-shell/ListHeader';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
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

  const panel = useSplitPanelOrThrow();

  let focusSearch: (() => void) | undefined;

  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: () => panel.isPanelActive() && !isTouchDevice(),
    search: {
      description: 'Search Drive',

      condition: () => !state.projectId(),

      run: () => {
        focusSearch?.();

        return true;
      },
    },
  });

  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <ListHeader
          title={<DriveBreadcrumbsOutlet aria-label="Drive location" />}
        >
          <Show when={state.value().location.kind === 'tab'}>
            <HeaderActionGroup label="File filters">
              <Suspense>
                <DriveFilterMenu />
              </Suspense>
            </HeaderActionGroup>
          </Show>
          <Show when={!isRecent()}>
            <HeaderActionGroup label="File view options">
              <ListSortDropdown
                label="Sort files"
                value={state.value().sort}
                onChange={state.setSort}
                options={DRIVE_SORT_OPTIONS}
              />
            </HeaderActionGroup>
          </Show>
          <DriveCreateMenu presentation="toolbar" />
          <Show when={!state.projectId()}>
            <ListHeaderSearch
              label="Search Drive"
              placeholder="Search files"
              value={state.value().search}
              onValueChange={state.setSearch}
              registerFocus={(focus) => {
                focusSearch = focus;
              }}
            />
          </Show>
        </ListHeader>
      }
    >
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
          <DriveMobileTabs />
        </div>
      </ViewShell.Header>
    </Show>
  );
}
