import {
  entityReferencesToIdSet,
  updateEntityReferences,
} from '@core/component/Properties/utils/entityConversion';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { createSignal, Show } from 'solid-js';
import { useProperty } from '../../core/context';
import type { EntityProperty, PropertyApiValues } from '../../types';
import { isEntityProperty } from '../../utils';
import { PropertyEntitySelector } from '../selectors/PropertyEntitySelector';
import { EditorPopover } from './EditorPopover';

export type EntityEditorProps = {
  /**
   * Owning entity context for the property — used by PropertyEntitySelector
   * to filter the current entity out of the picker. Omit when no self-filter
   * is needed (e.g. composer with no entity yet).
   */
  selfFilter?: { entityType: EntityType; blockId?: string };
};

/**
 * Popover dropdown for ENTITY properties. Wraps PropertyEntitySelector;
 * saves accumulated selection on close.
 */
export function EntityEditor(props: EntityEditorProps) {
  const ctx = useProperty();
  return (
    <Show when={ctx.editorOpen() && isEntityProperty(ctx.property())}>
      <EntityEditorBody selfFilter={props.selfFilter} />
    </Show>
  );
}

function EntityEditorBody(props: EntityEditorProps) {
  const ctx = useProperty();
  const property = ctx.property() as EntityProperty;

  const initialRefs: EntityReference[] = property.value ?? [];
  const [selectedRefs, setSelectedRefs] =
    createSignal<EntityReference[]>(initialRefs);
  const [dirty, setDirty] = createSignal(false);

  const refsEqual = (a: EntityReference[], b: EntityReference[]) => {
    if (a.length !== b.length) return false;
    return a.every((aRef) =>
      b.some(
        (bRef) =>
          aRef.entity_id === bRef.entity_id &&
          aRef.entity_type === bRef.entity_type
      )
    );
  };

  const closeAndSave = async () => {
    if (dirty() && !refsEqual(selectedRefs(), initialRefs)) {
      const refs = selectedRefs();
      const apiValues: PropertyApiValues = {
        valueType: 'ENTITY',
        refs: refs.length > 0 ? refs : null,
      };
      try {
        await ctx.onSave?.(property, apiValues);
        ctx.onRefresh?.();
      } catch {
        // mutation onError owns toast
      }
    }
    ctx.closeEditor();
  };

  return (
    <EditorPopover onClose={closeAndSave}>
      <PropertyEntitySelector
        config={{
          isMultiSelect: property.isMultiSelect,
          placeholder: `${property.isMultiSelect ? 'Add' : 'Change'} ${property.displayName.toLowerCase()}...`,
          specificEntityType: property.specificEntityType,
          selfFilter: props.selfFilter,
        }}
        selectedOptions={() => entityReferencesToIdSet(selectedRefs())}
        setSelectedOptions={(newOptions, entityInfo) => {
          const updated = updateEntityReferences(
            selectedRefs(),
            newOptions,
            entityInfo
          );
          setSelectedRefs(updated);
          setDirty(true);
        }}
        onClose={closeAndSave}
      />
    </EditorPopover>
  );
}
