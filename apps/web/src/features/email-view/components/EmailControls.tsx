import { ListFilterDropdown } from '@app/components/view-shell';
import { PreviewButton } from '@components/app/split-layout/components/PreviewButton';
import { Show } from 'solid-js';
import { useEmailView } from '../email-view-context';
import { useEmailFilters } from '../filters/use-email-filters';

export type EmailControlsProps = {
  /** Controlled filter-menu state, so the header's `f` hotkey can open it. */
  filterOpen?: boolean;
  onFilterOpenChange?: (open: boolean) => void;
};

export function EmailControls(props: EmailControlsProps) {
  const { setPreviewOpen } = useEmailView();

  const filters = useEmailFilters();

  return (
    <div class="flex min-w-0 shrink-0 items-center justify-end gap-2 @max-[720px]/view-shell:gap-1">
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
          <span class="pointer-events-none absolute -top-0.5 right-0 flex size-4 translate-x-1/2 items-center justify-center rounded-full bg-accent text-xxs font-medium leading-none text-surface">
            {filters.activeCount()}
          </span>
        </Show>
      </div>
      <PreviewButton
        iconOnly
        class="rounded-lg"
        onOpenChange={setPreviewOpen}
      />
    </div>
  );
}
