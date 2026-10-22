import {
  ListFilterCountBadge,
  ListFilterDropdown,
  ListSortDropdown,
} from '@app/components/view-shell';
import { TOKENS } from '@core/hotkey/tokens';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import ColumnsIcon from '@phosphor/columns.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { EMAIL_FOCUS_SORT_OPTIONS } from '../constants';
import { useEmailView } from '../email-view-context';
import { useEmailFilters } from '../filters/use-email-filters';

const FOCUS_SORT_OPTIONS = EMAIL_FOCUS_SORT_OPTIONS.map((option) => ({
  id: option.id,
  label: option.label,
  content:
    option.description === undefined
      ? undefined
      : () => (
          <span class="flex flex-col">
            <span>{option.label}</span>
            <span class="text-xs text-ink-muted">{option.description}</span>
          </span>
        ),
}));

export type EmailControlsProps = {
  /** Controlled filter-menu state, so the header's `f` hotkey can open it. */
  filterOpen?: boolean;
  onFilterOpenChange?: (open: boolean) => void;
};

export function EmailControls(props: EmailControlsProps) {
  const { state, setFocusSort, readingPane, setReadingPane } = useEmailView();
  const filters = useEmailFilters();

  return (
    <div class="flex min-w-0 shrink-0 items-center justify-end gap-2 @max-[720px]/view-shell:gap-1">
      <Show when={!isTouchDevice()}>
        <Button
          variant="ghost"
          size="icon-sm"
          label={readingPane() ? 'Hide reading pane' : 'Show reading pane'}
          hotkey={TOKENS.email.toggleReadingPane}
          aria-pressed={readingPane()}
          class={readingPane() ? 'text-ink' : 'text-ink-muted'}
          onClick={() => setReadingPane(!readingPane())}
        >
          <ColumnsIcon class="size-4" />
        </Button>
      </Show>
      <Show when={state.tab === 'focus'}>
        <ListSortDropdown
          label="Sort Focus"
          value={state.focusSort}
          options={FOCUS_SORT_OPTIONS}
          onChange={setFocusSort}
        />
      </Show>
      <div class="relative shrink-0">
        <ListFilterDropdown
          label="Filter email"
          open={props.filterOpen}
          onOpenChange={props.onFilterOpenChange}
          groups={filters.groups()}
          isSelected={filters.isSelected}
          onSelectionChange={filters.setSelected}
          onClear={filters.clear}
        />
        <ListFilterCountBadge count={filters.activeCount()} />
      </div>
    </div>
  );
}
