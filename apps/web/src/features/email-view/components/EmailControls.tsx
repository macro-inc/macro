import { ListFilterDropdown } from '@app/components/view-shell';
import { TOKENS } from '@core/hotkey/tokens';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import ColumnsIcon from '@phosphor/columns.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { useEmailView } from '../email-view-context';
import { useEmailFilters } from '../filters/use-email-filters';

export type EmailControlsProps = {
  /** Controlled filter-menu state, so the header's `f` hotkey can open it. */
  filterOpen?: boolean;
  onFilterOpenChange?: (open: boolean) => void;
};

export function EmailControls(props: EmailControlsProps) {
  const filters = useEmailFilters();
  const { readingPane, setReadingPane } = useEmailView();

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
        <Show when={filters.activeCount() > 0}>
          <span class="pointer-events-none absolute -top-0.5 right-0 z-10 flex size-4 translate-x-1/2 items-center justify-center rounded-full bg-accent text-xxs font-medium leading-none text-surface">
            {filters.activeCount()}
          </span>
        </Show>
      </div>
    </div>
  );
}
