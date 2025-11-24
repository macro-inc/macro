import { useUpsertSavedViewMutation } from '@app/component/Soup';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import type { ViewConfigBase } from '@app/component/ViewConfig';
import { unwrapSignals } from '@core/util/unwrapSignals';
import { createMemo, createSignal, onMount } from 'solid-js';
import { createRenameDssEntityMutation } from '../../../macro-entity/src/queries/dss';
import type { EntityData } from '../../../macro-entity/src/types/entity';
import { EntityModalActionFooter, EntityModalTitle } from './EntityModal';

export const RenameView = (props: {
  entity?: EntityData;
  viewId?: string;
  onFinish: () => void;
  onCancel: () => void;
}) => {
  const renameMutation = createRenameDssEntityMutation();
  let inputRef: HTMLInputElement | undefined;
  const saveViewMutation = useUpsertSavedViewMutation();
  const {
    unifiedListContext: { viewsDataStore: viewsData },
  } = useSplitPanelOrThrow();

  const view = createMemo(() => {
    if (props.viewId) {
      return viewsData[props.viewId];
    }
    return null;
  });

  const [editValue, setEditValue] = createSignal(
    props.entity?.name || view()?.view || ''
  );

  const currentViewConfigBase = createMemo(() => {
    const foundView = view();
    if (!foundView) return null;
    return unwrapSignals<ViewConfigBase>({
      display: foundView.display,
      filters: foundView.filters,
      sort: foundView.sort,
    });
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEditing();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      props.onCancel();
    }
  };

  const finishEditing = async () => {
    const newValue = editValue().trim();

    // Handle view renaming
    if (props.viewId && newValue) {
      const viewConfig = currentViewConfigBase();
      if (viewConfig) {
        saveViewMutation.mutate({
          id: props.viewId,
          name: newValue,
          config: viewConfig,
        });
      }
    }

    // Handle entity renaming
    if (newValue && props.entity) {
      await renameMutation.mutateAsync({
        entity: props.entity,
        newName: newValue,
      });
    }

    props.onFinish();
  };

  return (
    <div class="w-full">
      <EntityModalTitle title="Rename" />
      <div class="w-full focus-within:bracket-offset-2">
        <input
          ref={(el) => {
            inputRef = el;
            onMount(() => {
              // it needs to focus on next task, no idea why
              setTimeout(() => {
                inputRef?.focus();
                inputRef?.select();
              });
            });
          }}
          value={editValue()}
          onInput={(e) => setEditValue(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          class="w-full p-2 text-sm border-1 border-edge/20 bg-menu text-ink placeholder:text-ink-placeholder focus:outline-none selection:bg-ink selection:text-panel"
          placeholder="Enter title..."
        />
      </div>

      <EntityModalActionFooter
        onCancel={props.onCancel}
        onConfirm={finishEditing}
        confirmText="Rename"
      />
    </div>
  );
};
