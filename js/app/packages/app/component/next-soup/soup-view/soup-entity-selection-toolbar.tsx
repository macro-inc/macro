import {
  resetCommandCategoryIndex,
  searchCategories,
  setCommandCategoryIndex,
  setKonsoleContextInformation,
} from '@app/component/command/KonsoleItem';
import {
  resetKonsoleMode,
  setKonsoleMode,
  toggleKonsoleVisibility,
} from '@app/component/command/state';
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
  return (
    <EntitySelectionToolbarModal
      multiSelectEntities={props.selected}
      onClose={props.onClose}
      onAction={() => {
        const selected = props.selected;
        const hasSelection = selected.length > 0;
        if (!hasSelection) {
          searchCategories.hideCategory('Selection');
          resetCommandCategoryIndex();
          resetKonsoleMode();
          return;
        }

        setKonsoleMode('SELECTION_MODIFICATION');
        const selectionIndex = searchCategories.getCategoryIndex('Selection');

        if (selectionIndex === undefined) return false;

        setCommandCategoryIndex(selectionIndex);

        searchCategories.showCategory('Selection');

        setKonsoleContextInformation({
          selectedEntities: selected.slice(),
          clearSelection: props.onClear,
        });

        toggleKonsoleVisibility();
      }}
    />
  );
};
