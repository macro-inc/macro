import {
  ListFilterDropdown,
  useViewControlHotkeys,
} from '@app/components/view-shell';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { createSignal } from 'solid-js';
import { useDriveFilters } from '../filters/use-drive-filters';

export function DriveFilterMenu(props: { grouped?: boolean } = {}) {
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
    <ListFilterDropdown
      grouped={props.grouped}
      size={filters.activeCount() ? 'md' : 'icon-md'}
      label="Filter files"
      activeCount={filters.activeCount()}
      open={open()}
      onOpenChange={setOpen}
      groups={filters.groups()}
      onClear={filters.clear}
      isSelected={filters.isSelected}
      selectedIds={filters.selectedIds}
      onSelectionChange={filters.setSelected}
    />
  );
}
