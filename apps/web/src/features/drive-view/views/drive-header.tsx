import {
  ListSortDropdown,
  SearchBar,
  useViewControlHotkeys,
  ViewShell,
} from '@app/components/view-shell';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import FolderPlusIcon from '@phosphor/folder-plus.svg';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import { Button } from '@ui';
import { createSignal, Show, Suspense } from 'solid-js';
import { DriveBreadcrumbsOutlet } from '../components/DriveBreadcrumbs';
import { useDriveView } from '../context/drive-context';
import {
  driveCreateDestinationLabel,
  driveLocationLabel,
} from '../core/location-label';
import { DRIVE_SORT_OPTIONS } from '../core/types';
import { DriveCreateMenu } from '../drive-create-menu';
import { DriveFilterMenu } from './drive-filter-menu';
import { DriveMobileTabs } from './drive-mobile-tabs';

export function DriveHeader() {
  const { state, sidebar } = useDriveView();
  const { popoverSplit } = useSplitLayout();

  const title = () =>
    driveLocationLabel(state.value().location, sidebar.folders());

  const isRecent = () => {
    const location = state.value().location;

    return location.kind === 'tab' && location.tab === 'recent';
  };

  const panel = useSplitPanelOrThrow();

  const [searchExpanded, setSearchExpanded] = createSignal(false);
  let searchInput: HTMLInputElement | undefined;

  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: () => panel.isPanelActive() && !isTouchDevice(),
    search: {
      description: 'Search Drive',

      condition: () => !state.projectId(),

      run: () => {
        setSearchExpanded(true);
        queueMicrotask(() => {
          searchInput?.focus();
          searchInput?.select();
        });

        return true;
      },
    },
  });

  const openFolderComposer = () => {
    popoverSplit({
      type: 'component',
      id: 'folder-compose',
      params: {
        parentId: state.projectId(),
        parentLabel: driveCreateDestinationLabel(
          state.projectId(),
          sidebar.folders()
        ),
        onSubmit: (submission: { folderId: string; name: string }) => {
          state.selectFolder(submission.folderId);
        },
      },
    });
  };

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
                  <Show
                    when={!state.projectId() && searchExpanded()}
                    fallback={<div class="flex-1" />}
                  >
                    <SearchBar
                      ref={(element) => {
                        searchInput = element;
                      }}
                      label="Search Drive"
                      placeholder="Search files"
                      value={state.value().search}
                      onValueChange={state.setSearch}
                      onClose={() => {
                        state.setSearch('');
                        setSearchExpanded(false);
                      }}
                      onEscape={() => setSearchExpanded(false)}
                      class="max-w-md flex-1"
                    />
                  </Show>
                  <div class="flex shrink-0 items-center gap-2">
                    <Show when={!state.projectId() && !searchExpanded()}>
                      <Button
                        size="sm"
                        variant="ghost"
                        square
                        label="Search files"
                        tooltip="Search files"
                        onClick={() => {
                          setSearchExpanded(true);
                          queueMicrotask(() => {
                            searchInput?.focus();
                          });
                        }}
                      >
                        <MagnifyingGlassIcon class="size-4" />
                      </Button>
                    </Show>
                    <Button
                      size="sm"
                      variant="ghost"
                      square
                      label="New folder"
                      tooltip="New folder"
                      onClick={openFolderComposer}
                    >
                      <FolderPlusIcon class="size-4" />
                    </Button>
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
