import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { Component } from 'solid-js';
import { For, Show } from 'solid-js';
import { EntityValueDisplay } from '../../EntityValueDisplay';
import type { Property } from '../../types';

type EntityValueProps = {
  property: Property;
  canEdit: boolean;
  entityType: EntityType;
  onEdit?: (property: Property, anchor?: HTMLElement) => void;
};

/**
 * Display component for entity properties
 * Shows entity badges and opens modal on click
 */
export const EntityValue: Component<EntityValueProps> = (props) => {
  const handleEditClick = (e: MouseEvent) => {
    if (props.canEdit && !props.property.isMetadata) {
      props.onEdit?.(props.property, e.currentTarget as HTMLElement);
    }
  };

  const isReadOnly = () => props.property.isMetadata || !props.canEdit;
  const entities = (props.property.value as EntityReference[]) ?? [];
  return (
    <div class="flex flex-wrap gap-1 justify-start items-start w-full min-w-0">
      <For each={entities}>
        {(entityRef) => {
          const linkableEntityTypes: EntityType[] = [
            'CHANNEL',
            'CHAT',
            'DOCUMENT',
            'PROJECT',
          ]; // thread, user
          const isLinkEnabled = linkableEntityTypes.includes(
            entityRef.entity_type
          );
          return (
            <div
              class={`text-xs px-2 py-1 border border-edge ${isLinkEnabled ? 'hover:bg-hover cursor-pointer' : ''} bg-transparent text-ink max-w-[150px] truncate shrink-0`}
            >
              <EntityValueDisplay
                property={props.property}
                entityId={entityRef.entity_id}
                entityType={entityRef.entity_type}
                enableLink={isLinkEnabled}
              />
            </div>
          );
        }}
      </For>
      <Show
        when={!isReadOnly()}
        fallback={
          <Show when={entities.length === 0}>
            <div
              onClick={handleEditClick}
              class="text-ink-muted text-xs px-2 py-1 border border-edge bg-transparent inline-block shrink-0"
            >
              {<>—</>}
            </div>
          </Show>
        }
      >
        <button
          onClick={handleEditClick}
          class="text-ink-muted hover:text-ink text-xs hover:bg-hover px-2 py-1 cursor-pointer border border-edge bg-transparent inline-block shrink-0"
        >
          {props.property.isMultiSelect ? '+' : '>'}
        </button>
      </Show>
    </div>
  );
};
