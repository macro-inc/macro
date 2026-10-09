import {
  ListFilterCountBadge,
  ListFilterDropdown,
} from '@app/components/view-shell';
import { useEmailFilters } from '../filters/use-email-filters';

export type EmailControlsProps = {
  /** Controlled filter-menu state, so the header's `f` hotkey can open it. */
  filterOpen?: boolean;
  onFilterOpenChange?: (open: boolean) => void;
};

export function EmailControls(props: EmailControlsProps) {
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
        <ListFilterCountBadge count={filters.activeCount()} />
      </div>
    </div>
  );
}
