import { CommandState } from '@app/features/command/state';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { EntitySelectionToolbarModal } from './EntitySelectionToolbarModal';
import type { EntityData } from './types/entity';

export type EntitySelectionToolbarProps = {
  selected: EntityData[];
  onClear: VoidFunction;
  analyticsSource?: string;
};

export function EntitySelectionToolbar(props: EntitySelectionToolbarProps) {
  const analytics = useAnalytics();

  return (
    <EntitySelectionToolbarModal
      multiSelectEntities={props.selected}
      onClose={props.onClear}
      onAction={() => {
        if (props.selected.length === 0) return;
        analytics.track('command_menu_open', {
          from: props.analyticsSource ?? 'entity_list_selection_toolbar',
        });
        CommandState.openForEntityAction(props.selected);
      }}
    />
  );
}
