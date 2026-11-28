import {
  ListSortDropdown,
  useViewControlHotkeys,
} from '@app/components/view-shell';
import {
  ListHeader,
  ListHeaderSearch,
} from '@app/components/view-shell/ListHeader';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createLabelCollapse } from '@core/signal/create-label-collapse';
import { cn } from '@ui';
import { createSignal, Show, Suspense } from 'solid-js';
import { DriveBreadcrumbsOutlet } from '../components/DriveBreadcrumbs';
import { useDriveView } from '../context/drive-context';
import { DRIVE_SORT_OPTIONS } from '../core/types';
import { DriveCreateMenu } from '../drive-create-menu';
import { DriveFilterMenu } from './drive-filter-menu';

/** What the header gives up, in order, when its actions would overflow it. */
const HEADER_COLLAPSE_ORDER = ['viewOptions', 'filters'] as const;

export function DriveHeader() {
  const { state } = useDriveView();

  const isRecent = () => {
    const location = state.value().location;

    return location.kind === 'tab' && location.tab === 'recent';
  };

  const panel = useSplitPanelOrThrow();

  let focusSearch: (() => void) | undefined;
  // A narrow pane (the desktop window has no minimum width) hides Sort, then
  // Filter, rather than push New and Search past the header's edge. Each
  // comes back once there is room.
  const [actions, setActions] = createSignal<HTMLDivElement>();
  const collapsed = createLabelCollapse(actions, () => HEADER_COLLAPSE_ORDER, {
    watchContent: true,
  });

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
    <Show when={!isTouchDevice()}>
      <ListHeader
        actionsRef={setActions}
        title={<DriveBreadcrumbsOutlet aria-label="Drive location" />}
      >
        {/* Wrappers the header's row keeps, so hiding a group never adds or removes a child. */}
        <div class={cn('contents', collapsed('filters') && 'hidden')}>
          <Show when={state.value().location.kind === 'tab'}>
            <HeaderActionGroup label="File filters" size="md">
              <Suspense>
                <DriveFilterMenu grouped hidden={collapsed('filters')} />
              </Suspense>
            </HeaderActionGroup>
          </Show>
        </div>
        <div class={cn('contents', collapsed('viewOptions') && 'hidden')}>
          <Show when={!isRecent()}>
            <HeaderActionGroup label="File view options" size="md">
              <ListSortDropdown
                grouped
                size="icon-md"
                label="Sort files"
                value={state.value().sort}
                onChange={state.setSort}
                options={DRIVE_SORT_OPTIONS}
              />
            </HeaderActionGroup>
          </Show>
        </div>
        <DriveCreateMenu presentation="toolbar" />
        <Show when={!state.projectId()}>
          <ListHeaderSearch
            label="Search Drive"
            placeholder="Search files"
            value={state.value().search}
            focusResults={() => panel.panelRef()?.focus()}
            onValueChange={state.setSearch}
            registerFocus={(focus) => {
              focusSearch = focus;
            }}
          />
        </Show>
      </ListHeader>
    </Show>
  );
}
