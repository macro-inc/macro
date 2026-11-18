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
import { createSignal, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import type { ReviewsStatusTabId } from '../reviews-types';
import { ReviewsListHeader } from '../views/ReviewsListHeader';

/**
 * The real Reviews list header, status tabs, New and Search, with icon
 * stand-ins for the filter, layout and sort islands. `?width=<px>` sizes the
 * pane; `?board` drops the status tabs, as the board layout does.
 */
function Fixture() {
  const params = new URLSearchParams(location.search);
  const [status, setStatus] = createSignal<ReviewsStatusTabId>('open');
  const [search, setSearch] = createSignal('');
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
            params.has('board')
              ? undefined
              : { value: status(), onChange: setStatus }
          }
        >
          <HeaderActionGroup label="Review filters" size="md">
            {island('Filter pull requests', <FunnelIcon class="size-4" />)}
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
    </div>
  );
}

const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
