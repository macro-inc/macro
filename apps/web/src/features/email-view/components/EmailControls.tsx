import {
  ListFilterDropdown,
  ListSortDropdown,
} from '@app/components/view-shell';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { TOKENS } from '@core/hotkey/tokens';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import ColumnsIcon from '@icon/system/regular/columns.svg';
import { ButtonGroup } from '@ui';
import { Show } from 'solid-js';
import { EMAIL_FOCUS_SORT_OPTIONS } from '../constants';
import { useEmailView } from '../email-view-context';
import { useEmailFilters } from '../filters/use-email-filters';
import { EmailInboxMenu } from './EmailInboxSelector';

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
  const filters = useEmailFilters();
  const { state, setFocusSort, readingPane, setReadingPane } = useEmailView();

  return (
    <>
      <div class="contents @max-[640px]/split-header:hidden">
        <HeaderActionGroup label="Email filters" size="md">
          <EmailInboxMenu grouped />
          <div class="relative flex shrink-0 items-center">
            <ListFilterDropdown
              grouped
              size="icon-md"
              label="Filter email"
              open={props.filterOpen}
              onOpenChange={props.onFilterOpenChange}
              groups={filters.groups()}
              isSelected={filters.isSelected}
              selectedIds={filters.selectedIds}
              onSelectionChange={filters.setSelected}
              onClear={filters.clear}
            />
            <Show when={filters.activeCount() > 0}>
              <span class="pointer-events-none absolute -top-0.5 right-0 z-10 flex size-4 translate-x-1/2 not-touch:top-0.5 not-touch:right-0.5 not-touch:size-3.5 not-touch:translate-x-0 items-center justify-center rounded-full bg-accent text-xxs font-medium leading-none text-surface">
                {filters.activeCount()}
              </span>
            </Show>
          </div>
        </HeaderActionGroup>
      </div>
      <HeaderActionGroup label="Email view options" size="md">
        <Show when={state.tab === 'focus'}>
          <ListSortDropdown
            grouped
            size="icon-md"
            label="Sort Focus"
            value={state.focusSort}
            options={FOCUS_SORT_OPTIONS}
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
    </>
  );
}
