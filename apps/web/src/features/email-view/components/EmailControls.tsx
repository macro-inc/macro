import {
  ListFilterDropdown,
  ListSortDropdown,
} from '@app/components/view-shell';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { TOKENS } from '@core/hotkey/tokens';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import ColumnsIcon from '@icon/system/regular/columns.svg';
import { ButtonGroup, cn } from '@ui';
import { Show } from 'solid-js';
import { EMAIL_FOCUS_SORT_OPTIONS } from '../constants';
import { useEmailView } from '../email-view-context';
import { useEmailFilters } from '../filters/use-email-filters';
import { EmailInboxMenu } from './EmailInboxSelector';

export type EmailControlsProps = {
  /** Controlled filter-menu state, so the header's `f` hotkey can open it. */
  filterOpen?: boolean;
  onFilterOpenChange?: (open: boolean) => void;
  /** Hides the view options (sort, reading pane) when the header has no room. */
  hideViewOptions?: boolean;
};

export function EmailControls(props: EmailControlsProps) {
  const filters = useEmailFilters();
  const { state, setFocusSort, readingPane, setReadingPane } = useEmailView();

  return (
    <>
      <div class="contents @max-[640px]/split-header:hidden">
        <HeaderActionGroup label="Email filters" size="md">
          <EmailInboxMenu grouped />
          <ListFilterDropdown
            grouped
            size={filters.activeCount() ? 'md' : 'icon-md'}
            label="Filter email"
            activeCount={filters.activeCount()}
            open={props.filterOpen}
            onOpenChange={props.onFilterOpenChange}
            groups={filters.groups()}
            isSelected={filters.isSelected}
            selectedIds={filters.selectedIds}
            isGroupActive={filters.isGroupActive}
            onSelectionChange={filters.setSelected}
            onGroupSelectionChange={filters.setGroupSelection}
            onClear={filters.clear}
          />
        </HeaderActionGroup>
      </div>
      {/* A wrapper the header's row keeps, so hiding it never adds or removes a child. */}
      <div class={cn('contents', props.hideViewOptions && 'hidden')}>
        <HeaderActionGroup label="Email view options" size="md">
          <Show when={state.tab === 'focus'}>
            <ListSortDropdown
              grouped
              size="icon-md"
              label="Sort Focus"
              value={state.focusSort}
              options={EMAIL_FOCUS_SORT_OPTIONS}
              onChange={setFocusSort}
            />
          </Show>
          <Show when={!isTouchDevice()}>
            <ButtonGroup.Button
              aria-label={
                readingPane() ? 'Hide reading pane' : 'Show reading pane'
              }
              tooltip={{
                content: readingPane()
                  ? 'Hide reading pane'
                  : 'Show reading pane',
                hotkey: TOKENS.email.toggleReadingPane,
              }}
              variant="ghost"
              size="icon-md"
              aria-pressed={readingPane()}
              class={readingPane() ? 'text-ink' : 'text-ink-muted'}
              onClick={() => setReadingPane(!readingPane())}
            >
              <ColumnsIcon class="size-4" />
            </ButtonGroup.Button>
          </Show>
        </HeaderActionGroup>
      </div>
    </>
  );
}
