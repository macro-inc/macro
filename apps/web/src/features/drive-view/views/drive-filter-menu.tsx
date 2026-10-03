import {
  ListFilterDropdown,
  useViewControlHotkeys,
} from '@app/components/view-shell';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { createSignal } from 'solid-js';
import { useDriveFilters } from '../filters/use-drive-filters';

export function DriveFilterMenu() {
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
      label="Filter files"
      open={open()}
      onOpenChange={setOpen}
      groups={filters.groups()}
      onClear={filters.clear}
      isSelected={filters.isSelected}
      onSelectionChange={filters.setSelected}
    />
  );
}
