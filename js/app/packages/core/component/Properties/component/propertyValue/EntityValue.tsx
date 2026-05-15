import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import type { Component } from 'solid-js';
import { createSignal, For, Show } from 'solid-js';
import { getEntityValues } from '../../utils';
import { EntityIcon } from './EntityIcon';
import {
  AddPropertyValueButton,
  EmptyValue,
  type PropertyValueProps,
  stubSaveHandler,
} from './ValueComponents';

/**
 * Display component for entity properties
 * Shows entity badges and opens modal on click
 */
export const EntityValue: Component<PropertyValueProps> = (props) => {
  const saveHandler = () => props.saveHandler ?? stubSaveHandler;
  const [isSaving, setIsSaving] = createSignal(false);

  const handleEditClick = (e: MouseEvent) => {
    if (props.canEdit && !props.property.isMetadata) {
      props.onEdit?.(props.property, e.currentTarget as HTMLElement);
    }
  };

  const handleEditEntity = (anchor?: HTMLElement) => {
    if (props.canEdit && !props.property.isMetadata) {
      props.onEdit?.(props.property, anchor);
    }
  };

  const handleRemoveEntity = async (entityToRemove: EntityReference) => {
    if (isReadOnly() || isSaving()) return;

    setIsSaving(true);

    try {
      const entities = getEntityValues(props.property);
      const newValues = entities.filter(
        (entity: EntityReference) =>
          entity.entity_id !== entityToRemove.entity_id ||
          entity.entity_type !== entityToRemove.entity_type
      );

      await saveHandler().saveProperty(props.property, {
        valueType: 'ENTITY',
        refs: newValues.length > 0 ? newValues : null,
      });
      props.onRefresh?.();
    } catch {
      // Error toast is shown by mutation's onError callback
    } finally {
      setIsSaving(false);
    }
  };

  const isReadOnly = () => props.property.isMetadata || !props.canEdit;
  const entities = getEntityValues(props.property);
  return (
    <div class="flex flex-wrap gap-1 justify-start items-start w-full min-w-0">
      <For each={entities}>
        {(entityRef) => (
          <EntityIcon
            property={props.property}
            entityId={entityRef.entity_id}
            entityType={entityRef.entity_type}
            specificMessageId={entityRef.specific_message_id}
            canEdit={!isReadOnly()}
            onRemove={() => handleRemoveEntity(entityRef)}
            onEdit={handleEditEntity}
            isSaving={isSaving()}
          />
        )}
      </For>
      <Show
        when={!isReadOnly()}
        fallback={
          <Show when={entities.length === 0}>
            <div class="text-ink-muted px-2 py-0.5 bg-transparent inline-block shrink-0 rounded-sm">
              <EmptyValue />
            </div>
          </Show>
        }
      >
        <Show when={entities.length === 0 || props.property.isMultiSelect}>
          <AddPropertyValueButton onClick={handleEditClick} />
        </Show>
      </Show>
    </div>
  );
};
