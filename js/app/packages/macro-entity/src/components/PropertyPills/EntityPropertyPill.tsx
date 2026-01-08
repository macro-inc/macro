import { SYSTEM_PROPERTY_IDS } from '@core/component/Properties/constants';
import { usePropertyEntityDisplay } from '@core/component/Properties/hooks';
import type { Property } from '@core/component/Properties/types';
import { PropertyDataTypeIcon } from '@core/component/Properties/utils';
import { Tooltip } from '@core/component/Tooltip';
import { UserIcon } from '@core/component/UserIcon';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { createMemo, For, Show } from 'solid-js';
import { PropertyPillTooltip } from './PropertyPillTooltip';

type EntityPropertyPillProps = {
  property: Property & { valueType: 'ENTITY' };
};

/**
 * Pill for entity properties
 * Single value: shows entity name directly with tooltip
 * Multi value: shows "Property Name (N)" with tooltip
 */
export const EntityPropertyPill = (props: EntityPropertyPillProps) => {
  const entities = () => props.property.value ?? [];
  const count = () => entities().length;

  if (count() === 0) return null;

  // Special handling for ASSIGNEES property - show as user avatars
  if (props.property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.ASSIGNEES) {
    return <AssigneesPill property={props.property} entities={entities()} />;
  }

  // Single entity - show name directly in pill
  if (count() === 1) {
    return (
      <SingleEntityPill property={props.property} entity={entities()[0]} />
    );
  }

  // Multiple entities - show count with tooltip
  return <MultiEntityPill property={props.property} entities={entities()} />;
};

type SingleEntityPillProps = {
  property: Property & { valueType: 'ENTITY' };
  entity: EntityReference;
};

const SingleEntityPill = (props: SingleEntityPillProps) => {
  const { name, icon } = usePropertyEntityDisplay(
    () => props.entity.entity_id,
    () => props.entity.entity_type as EntityType,
    {
      fallbackIcon: (
        <PropertyDataTypeIcon
          property={{
            data_type: 'ENTITY',
            specific_entity_type: props.property.specificEntityType,
          }}
        />
      ),
    }
  );

  return (
    <Tooltip
      unstyled
      tooltip={
        <SingleEntityTooltipContent
          property={props.property}
          entity={props.entity}
        />
      }
      floatingOptions={{
        offset: 4,
        flip: true,
        shift: { padding: 8 },
      }}
    >
      <div class="inline-flex items-center gap-1.5 p-1.5 @3xl/soup:px-2 @3xl/soup:py-1 text-xs leading-none text-ink-muted border border-edge-muted rounded box-border h-fit">
        <Show when={icon()}>{icon()}</Show>
        <span class="truncate max-w-[120px] hidden @3xl/soup:inline">
          {name()}
        </span>
      </div>
    </Tooltip>
  );
};

type SingleEntityTooltipContentProps = {
  property: Property & { valueType: 'ENTITY' };
  entity: EntityReference;
};

const SingleEntityTooltipContent = (props: SingleEntityTooltipContentProps) => {
  return (
    <PropertyPillTooltip property={props.property}>
      <div class="flex items-center gap-1.5 flex-wrap">
        <EntityValuePill entity={props.entity} />
      </div>
    </PropertyPillTooltip>
  );
};

type MultiEntityPillProps = {
  property: Property & { valueType: 'ENTITY' };
  entities: EntityReference[];
};

const MultiEntityPill = (props: MultiEntityPillProps) => {
  return (
    <Tooltip
      unstyled
      tooltip={
        <EntityTooltipContent
          property={props.property}
          entities={props.entities}
        />
      }
      floatingOptions={{
        offset: 4,
        flip: true,
        shift: { padding: 8 },
      }}
    >
      <div class="inline-flex items-center gap-1.5 p-1.5 @3xl/soup:px-2 @3xl/soup:py-1 text-xs leading-none text-ink-muted border border-edge-muted rounded box-border h-fit">
        <PropertyDataTypeIcon
          property={{
            data_type: 'ENTITY',
            specific_entity_type: props.property.specificEntityType,
          }}
          class="size-3.5 shrink-0"
        />
        <span class="truncate max-w-[120px] hidden @3xl/soup:inline">
          {props.property.displayName} ({props.entities.length})
        </span>
      </div>
    </Tooltip>
  );
};

type EntityTooltipContentProps = {
  property: Property & { valueType: 'ENTITY' };
  entities: EntityReference[];
};

const EntityTooltipContent = (props: EntityTooltipContentProps) => {
  return (
    <PropertyPillTooltip property={props.property}>
      <div class="flex items-center gap-1.5 flex-wrap">
        <For each={props.entities}>
          {(entity) => <EntityValuePill entity={entity} />}
        </For>
      </div>
    </PropertyPillTooltip>
  );
};

type EntityValuePillProps = {
  entity: EntityReference;
};

const EntityValuePill = (props: EntityValuePillProps) => {
  const { name, icon } = usePropertyEntityDisplay(
    () => props.entity.entity_id,
    () => props.entity.entity_type as EntityType,
    { fallbackIcon: null }
  );

  return (
    <div class="inline-flex items-center gap-1.5 px-2 py-1 text-xs leading-none text-ink-muted border border-edge-muted rounded box-border h-fit w-fit">
      <Show when={icon()}>{icon()}</Show>
      <span class="truncate max-w-[150px]">{name()}</span>
    </div>
  );
};

const MAX_ASSIGNEE_AVATARS = 3;

type AssigneesPillProps = {
  property: Property & { valueType: 'ENTITY' };
  entities: EntityReference[];
};

/**
 * Special pill for assignees that shows user avatars in LiveIndicators style
 */
const AssigneesPill = (props: AssigneesPillProps) => {
  const remaining = createMemo(() => {
    if (props.entities.length <= MAX_ASSIGNEE_AVATARS) return undefined;
    return props.entities.length - MAX_ASSIGNEE_AVATARS;
  });

  const displayEntities = () => props.entities.slice(0, MAX_ASSIGNEE_AVATARS);

  return (
    <Tooltip
      unstyled
      tooltip={
        <AssigneeTooltipContent
          property={props.property}
          entities={props.entities}
        />
      }
      floatingOptions={{
        offset: 4,
        flip: true,
        shift: { padding: 8 },
      }}
    >
      <div class="flex items-center h-fit shrink-0 overflow-hidden w-fit isolate">
        <For each={displayEntities()}>
          {(entity) => (
            <div class="bg-panel size-6 rounded-full p-[2px] -mr-3">
              <UserIcon id={entity.entity_id} isDeleted={false} size="fill" />
            </div>
          )}
        </For>
        <Show when={remaining()}>
          <div class="z-4">
            <div class="size-6 bg-menu border-2 text-[10px] -mr-3 border-panel rounded-full flex flex-col justify-center items-center">
              <span>+{remaining()}</span>
            </div>
          </div>
        </Show>
      </div>
    </Tooltip>
  );
};

type AssigneeTooltipContentProps = {
  property: Property & { valueType: 'ENTITY' };
  entities: EntityReference[];
};

const AssigneeTooltipContent = (props: AssigneeTooltipContentProps) => {
  return (
    <PropertyPillTooltip property={props.property}>
      <div class="flex flex-col gap-1.5">
        <For each={props.entities}>
          {(entity) => <AssigneeTooltipItem entity={entity} />}
        </For>
      </div>
    </PropertyPillTooltip>
  );
};

type AssigneeTooltipItemProps = {
  entity: EntityReference;
};

const AssigneeTooltipItem = (props: AssigneeTooltipItemProps) => {
  const { name } = usePropertyEntityDisplay(
    () => props.entity.entity_id,
    () => props.entity.entity_type as EntityType,
    { fallbackIcon: null }
  );

  return (
    <div class="inline-flex items-center gap-1.5 px-2 py-1 text-xs leading-none text-ink-muted border border-edge-muted rounded box-border h-fit w-fit">
      <div class="size-4 rounded-full overflow-hidden shrink-0">
        <UserIcon id={props.entity.entity_id} isDeleted={false} size="fill" />
      </div>
      <span class="truncate max-w-[150px]">{name()}</span>
    </div>
  );
};
