import { CommandState } from '@app/features/command/state';
import { EntitySelectionToolbarModal } from '@app/features/entity/EntitySelectionToolbarModal';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import type { EntityData } from '@entity';

interface SoupEntitySelectionToolbarProps {
  selected: EntityData[];
  onClose: VoidFunction;
  onClear: VoidFunction;
}

export const SoupEntitySelectionToolbar = (
  props: SoupEntitySelectionToolbarProps
) => {
  const analytics = useAnalytics();

  return (
    <EntitySelectionToolbarModal
      multiSelectEntities={props.selected}
      onClose={props.onClose}
      onAction={() => {
        const selected = props.selected;
        const hasSelection = selected.length > 0;
        if (!hasSelection) {
          return;
        }

        analytics.track('command_menu_open', {
          from: 'soup_view_selection_toolbar',
        });
        // Open the command menu in entity action mode, which shows only
        // selection modification commands with a preview of the selected entities
        CommandState.openForEntityAction(selected);
      }}
    />
  );
};
