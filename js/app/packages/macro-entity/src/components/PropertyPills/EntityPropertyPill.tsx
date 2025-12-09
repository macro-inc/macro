import { usePropertyEntityDisplay } from '@core/component/Properties/hooks';
import type { Property } from '@core/component/Properties/types';
import { PropertyDataTypeIcon } from '@core/component/Properties/utils';
import { Tooltip } from '@core/component/Tooltip';
import { cornerClip } from '@core/util/clipPath';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { For, Show } from 'solid-js';
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
        class="p-px bg-edge box-border h-fit flex items-center"
        style={{ 'clip-path': cornerClip('0.2rem', 0, 0, 0) }}
      >
        <div
          class="inline-flex items-center gap-1.5 p-1.5 @3xl/soup:px-2 @3xl/soup:py-1 text-xs leading-none text-ink-muted bg-panel box-border"
          style={{ 'clip-path': cornerClip('calc(0.2rem - 0.5px)', 0, 0, 0) }}
        >
          <Show when={icon()}>{icon()}</Show>
          <span class="truncate max-w-[120px] hidden @3xl/soup:inline">
            {name()}
          </span>
        </div>
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
        class="p-px bg-edge box-border h-fit flex items-center"
        style={{ 'clip-path': cornerClip('0.2rem', 0, 0, 0) }}
      >
        <div
          class="inline-flex items-center gap-1.5 p-1.5 @3xl/soup:px-2 @3xl/soup:py-1 text-xs leading-none text-ink-muted bg-panel box-border"
          style={{ 'clip-path': cornerClip('calc(0.2rem - 0.5px)', 0, 0, 0) }}
        >
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
    <div
      class="p-px bg-edge box-border h-fit w-fit flex items-center"
      style={{ 'clip-path': cornerClip('0.2rem', 0, 0, 0) }}
    >
      <div
        class="inline-flex items-center gap-1.5 px-2 py-1 text-xs leading-none text-ink-muted bg-panel box-border"
        style={{ 'clip-path': cornerClip('calc(0.2rem - 0.5px)', 0, 0, 0) }}
      >
        <Show when={icon()}>{icon()}</Show>
        <span class="truncate max-w-[150px]">{name()}</span>
      </div>
    </div>
  );
};
