import { globalSplitManager } from '@app/signal/splitLayout';
import { MenuItem } from '@core/component/Menu';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { intersection } from '@core/util/list';
import type { EntityData } from '@macro-entity';
import { type Setter, Show } from 'solid-js';
import { useSplitPanelOrThrow } from './split-layout/layoutUtils';
import type { EntityActionType } from './UnifiedEntityActions';

interface EntityActionsMenuItemsProps {
  entity: EntityData;
  onSelectAction: (action: EntityActionType) => void;
}

// TODO (seamus): this does not handle restoring the previous soup selection
//     very gracefully.

export const EntityActionsMenuItems = (props: EntityActionsMenuItemsProps) => {
  const { unifiedListContext } = useSplitPanelOrThrow();
  const { actionRegistry, viewsDataStore, selectedView } = unifiedListContext;

  const entities = () => {
    const { selectedEntities } = viewsDataStore[selectedView()];
    if (selectedEntities.length > 0) {
      if (selectedEntities.some((e) => e.id === props.entity.id)) {
        return selectedEntities;
      }
    }
    return [props.entity];
  };

  const setSelection: Setter<EntityData[]> = (entities) => {
    return unifiedListContext.setViewDataStore(
      selectedView(),
      'selectedEntities',
      entities
    );
  };

  const MenuItemInner = (props: {
    action: EntityActionType;
    label: string;
  }) => {
    return (
      <Show when={actionRegistry.has(props.action)}>
        <MenuItem
          text={props.label}
          disabled={actionRegistry.isActionDisabled(props.action, entities())}
          onClick={async () => {
            const { success, failedEntities } = await actionRegistry.execute(
              props.action,
              entities()
            );
            console.log({ success, failedEntities });
            if (success) {
              setSelection([]);
            } else if (failedEntities) {
              setSelection((prev) =>
                intersection(prev, failedEntities, (a, b) => a.id === b.id)
              );
            }
          }}
        />
      </Show>
    );
  };

  return (
    <>
      <MenuItemInner action="mark_as_done" label="Mark Done" />
      <MenuItemInner action="delete" label="Delete" />
      <MenuItem
        text="Open in new split"
        disabled={entities().length > 1}
        onClick={() => {
          const splitManager = globalSplitManager();
          if (!splitManager) {
            console.error('No split manager available');
            return;
          }
          if (props.entity.type === 'document') {
            const { fileType, id } = props.entity;
            splitManager.createNewSplit({
              type: fileTypeToBlockName(fileType),
              id,
            });
          } else {
            const { id, type } = props.entity;
            splitManager.createNewSplit({
              type,
              id,
            });
          }
        }}
      />
    </>
  );
};
