import {
  ListFilterCountBadge,
  ListFilterDropdown,
  useViewControlHotkeys,
} from '@app/components/view-shell';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import type { ButtonSize } from '@ui';
import { createSignal } from 'solid-js';
import { useDriveFilters } from '../filters/use-drive-filters';

export function DriveFilterMenu(
  props: { grouped?: boolean; size?: ButtonSize } = {}
) {
  const filters = useDriveFilters();

  const panel = useSplitPanelOrThrow();

  const [open, setOpen] = createSignal(false);

  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    filter: {
      description: 'Filter files',

      run: () => {
        setOpen(true);

        return true;
      },
    },
  });

  return (
    <div class="relative shrink-0">
      <ListFilterDropdown
        grouped={props.grouped}
        size={props.size}
        label="Filter files"
        open={open()}
        onOpenChange={setOpen}
        groups={filters.groups()}
        onClear={filters.clear}
        isSelected={filters.isSelected}
        selectedIds={filters.selectedIds}
        onSelectionChange={filters.setSelected}
      />
      <ListFilterCountBadge count={filters.activeCount()} />
    </div>
  );
}
