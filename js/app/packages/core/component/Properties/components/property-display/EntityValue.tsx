import { useBlockId } from '@core/block';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { Component } from 'solid-js';
import { createSignal, For, Show } from 'solid-js';
import { savePropertyValue } from '../../api/propertyValues';
import { EntityValueDisplay } from '../../EntityValueDisplay';
import type { Property } from '../../types';

type EntityValueProps = {
  property: Property;
  canEdit: boolean;
  entityType: EntityType;
  onEdit?: (property: Property, anchor?: HTMLElement) => void;
  onRefresh?: () => void;
};

/**
 * Display component for entity properties
 * Shows entity badges and opens modal on click
 */
export const EntityValue: Component<EntityValueProps> = (props) => {
  const blockId = useBlockId();
  const [isSaving, setIsSaving] = createSignal(false);

  const handleEditClick = (e: MouseEvent) => {
    if (props.canEdit && !props.property.isMetadata) {
      props.onEdit?.(props.property, e.currentTarget as HTMLElement);
    }
  };

  const handleRemoveEntity = async (entityToRemove: EntityReference) => {
    if (isReadOnly() || isSaving()) return;

    setIsSaving(true);

    try {
      const entities = (props.property.value as EntityReference[]) ?? [];
      const newValues = entities.filter(
        (entity) =>
          entity.entity_id !== entityToRemove.entity_id ||
          entity.entity_type !== entityToRemove.entity_type
      );

      const result = await savePropertyValue(
        blockId,
        props.entityType,
        props.property,
        {
          valueType: 'ENTITY',
          refs: newValues.length > 0 ? newValues : null,
        }
      );

      if (result.ok) {
        props.onRefresh?.();
      }
    } finally {
      setIsSaving(false);
    }
  };

  const isReadOnly = () => props.property.isMetadata || !props.canEdit;
  const entities = (props.property.value as EntityReference[]) ?? [];
  return (
    <div class="flex flex-wrap gap-1 justify-start items-start w-full min-w-0">
      <For each={entities}>
        {(entityRef) => (
          <EntityValueDisplay
            property={props.property}
            entityId={entityRef.entity_id}
            entityType={entityRef.entity_type}
            canEdit={!isReadOnly()}
            onRemove={() => handleRemoveEntity(entityRef)}
            isSaving={isSaving()}
          />
        )}
      </For>
      <Show
        when={!isReadOnly()}
        fallback={
          <Show when={entities.length === 0}>
            <div class="text-ink-muted text-xs px-2 py-1 border border-edge bg-transparent inline-block shrink-0">
              {<>—</>}
            </div>
          </Show>
        }
      >
        <Show when={entities.length === 0 || props.property.isMultiSelect}>
          <button
            onClick={handleEditClick}
            class="text-ink-muted hover:text-ink text-xs hover:bg-hover px-2 py-1 cursor-pointer border border-edge bg-transparent inline-block shrink-0"
          >
            {<>+</>}
          </button>
        </Show>
      </Show>
    </div>
  );
};
