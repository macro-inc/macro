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
  compressed?: boolean;
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

  // Show user avatars for multiselect user entity properties
  if (props.property.specificEntityType === 'USER') {
    return (
      <UserEntityPill
        property={props.property}
        entities={entities()}
        compressed={props.compressed}
      />
    );
  }

  // Single entity - show name directly in pill
  if (count() === 1) {
    return (
      <SingleEntityPill
        property={props.property}
        entity={entities()[0]}
        compressed={props.compressed}
      />
    );
  }

  // Multiple entities - show count with tooltip
  return (
    <MultiEntityPill
      property={props.property}
      entities={entities()}
      compressed={props.compressed}
    />
  );
};

type SingleEntityPillProps = {
  property: Property & { valueType: 'ENTITY' };
  entity: EntityReference;
  compressed?: boolean;
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
      <div
        class="inline-flex items-center gap-1.5 text-xs leading-none text-ink-muted border border-edge-muted h-fit p-1.5"
        classList={{
          '@3xl/soup:px-2 @3xl/soup:py-1': !props.compressed,
        }}
      >
        <Show when={icon()}>{icon()}</Show>
        <span
          class="truncate max-w-[120px] hidden"
          classList={{
            '@3xl/soup:inline': !props.compressed,
          }}
        >
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
  compressed?: boolean;
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
      <div
        class="inline-flex items-center gap-1.5 text-xs leading-none text-ink-muted border border-edge-muted h-fit p-1.5"
        classList={{
          '@3xl/soup:px-2 @3xl/soup:py-1': !props.compressed,
        }}
      >
        <PropertyDataTypeIcon
          property={{
            data_type: 'ENTITY',
            specific_entity_type: props.property.specificEntityType,
          }}
          class="size-3.5 shrink-0"
        />
        <span
          class="truncate max-w-[120px] hidden"
          classList={{
            '@3xl/soup:inline': !props.compressed,
          }}
        >
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
    <div class="inline-flex items-center gap-1.5 px-2 py-1 text-xs leading-none text-ink-muted border border-edge-muted h-fit w-fit">
      <Show when={icon()}>{icon()}</Show>
      <span class="truncate max-w-[150px]">{name()}</span>
    </div>
  );
};

const MAX_USER_AVATARS = 3;

type UserEntityPillProps = {
  property: Property & { valueType: 'ENTITY' };
  entities: EntityReference[];
  compressed?: boolean;
};

/**
 * Pill for multiselect user entity properties that shows user avatars in LiveIndicators style
 */
const UserEntityPill = (props: UserEntityPillProps) => {
  const remaining = createMemo(() => {
    if (props.entities.length <= MAX_USER_AVATARS) return undefined;
    return props.entities.length - MAX_USER_AVATARS;
  });

  const displayEntities = () => props.entities.slice(0, MAX_USER_AVATARS);

  return (
    <Tooltip
      unstyled
      tooltip={
        <UserEntityTooltipContent
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
      <div class="flex items-center h-fit shrink-0 overflow-hidden w-fit isolate pr-2">
        <For each={displayEntities()}>
          {(entity) => (
            <div class="bg-panel rounded-full p-[2px] -mr-2">
              <UserIcon id={entity.entity_id} isDeleted={false} size="xs" />
            </div>
          )}
        </For>
        <Show when={remaining()}>
          <div class="z-4">
            <div class="size-6 bg-menu border-2 text-[10px] -mr-2 border-panel rounded-full flex flex-col justify-center items-center">
              <span>+{remaining()}</span>
            </div>
          </div>
        </Show>
      </div>
    </Tooltip>
  );
};

type UserEntityTooltipContentProps = {
  property: Property & { valueType: 'ENTITY' };
  entities: EntityReference[];
};

const UserEntityTooltipContent = (props: UserEntityTooltipContentProps) => {
  return (
    <PropertyPillTooltip property={props.property}>
      <div class="flex flex-col gap-1.5">
        <For each={props.entities}>
          {(entity) => <UserEntityTooltipItem entity={entity} />}
        </For>
      </div>
    </PropertyPillTooltip>
  );
};

type UserEntityTooltipItemProps = {
  entity: EntityReference;
};

const UserEntityTooltipItem = (props: UserEntityTooltipItemProps) => {
  const { name } = usePropertyEntityDisplay(
    () => props.entity.entity_id,
    () => props.entity.entity_type as EntityType,
    { fallbackIcon: null }
  );

  return (
    <div class="inline-flex items-center gap-1.5 px-2 py-1 text-xs leading-none text-ink-muted border border-edge-muted h-fit w-fit">
      <div class="size-4 rounded-full overflow-hidden shrink-0">
        <UserIcon id={props.entity.entity_id} isDeleted={false} size="fill" />
      </div>
      <span class="truncate max-w-[150px]">{name()}</span>
    </div>
  );
};
