import { useAnalytics } from '@app/component/analytics-context';
import { CommandState } from '@app/component/command/state';
import { EntitySelectionToolbarModal } from '@app/component/EntitySelectionToolbarModal';
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
