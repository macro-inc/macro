import '@fontsource-variable/inter';
import '@app/index.css';
import { ListHeaderSearch } from '@app/components/view-shell/ListHeader';
import { ViewCreateButton } from '@app/components/view-shell/ViewCreateButton';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import FunnelIcon from '@icon/system/regular/funnel.svg';
import BoardIcon from '@icon/system/regular/kanban.svg';
import ListIcon from '@icon/system/regular/list-bullets.svg';
import SortIcon from '@icon/system/regular/sort-ascending.svg';
import { ButtonGroup } from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';
import { render } from 'solid-js/web';
import type { ReviewsStatusTabId } from '../reviews-types';
import { ReviewsListHeader } from '../views/ReviewsListHeader';

/** The real filter button counts the status preset among its filters. */
const STATUS_FILTER_COUNT: Record<ReviewsStatusTabId, number> = {
  open: 1,
  closed: 2,
  all: 0,
};

/**
 * The real Reviews list header, status tabs, New and Search, with stand-ins
 * for the filter, layout and sort islands. `?width=<px>` sizes the pane;
 * `?board` starts on the board layout, which has no status tabs.
 */
function Fixture() {
  const params = new URLSearchParams(location.search);
  const [status, setStatus] = createSignal<ReviewsStatusTabId>('open');
  const [search, setSearch] = createSignal('');
  const [board, setBoard] = createSignal(params.has('board'));
  const filterCount = () => STATUS_FILTER_COUNT[status()];
  const island = (label: string, icon: JSX.Element) => (
    <ButtonGroup.Button
      aria-label={label}
      tooltip={label}
      variant="ghost"
      size="icon-md"
    >
      {icon}
    </ButtonGroup.Button>
  );

  return (
    <div class="min-h-screen bg-page p-8 text-ink">
      <div
        data-testid="pane"
        class="rounded-xl bg-panel"
        style={{ width: `${params.get('width') ?? 1200}px` }}
      >
        <ReviewsListHeader
          scope={
            <button type="button" class="truncate px-1 text-sm font-medium">
              Involves me
            </button>
          }
          status={
            board() ? undefined : { value: status(), onChange: setStatus }
          }
        >
          <HeaderActionGroup label="Review filters" size="md">
            <ButtonGroup.Button
              aria-label="Filter pull requests"
              tooltip="Filter pull requests"
              variant="ghost"
              size={filterCount() ? 'md' : 'icon-md'}
            >
              <FunnelIcon class="size-4" />
              <Show when={filterCount()}>
                {(count) => <span>{count()}</span>}
              </Show>
            </ButtonGroup.Button>
          </HeaderActionGroup>
          <HeaderActionGroup label="Review layout" size="md">
            {island('List', <ListIcon class="size-4" />)}
            {island('Board', <BoardIcon class="size-4" />)}
          </HeaderActionGroup>
          <HeaderActionGroup label="Review view options" size="md">
            {island('Sort pull requests', <SortIcon class="size-4" />)}
          </HeaderActionGroup>
          <ViewCreateButton presentation="toolbar" menu aria-label="New" />
          <ListHeaderSearch
            label="Search reviews"
            value={search()}
            onValueChange={setSearch}
            registerFocus={() => {}}
          />
        </ReviewsListHeader>
      </div>
      <button
        type="button"
        class="mt-4 text-sm"
        onClick={() => setBoard(!board())}
      >
        Toggle board
      </button>
    </div>
  );
}

const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
