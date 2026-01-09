import { SYSTEM_PROPERTY_IDS } from '@core/component/Properties/constants';
import type { Property } from '@core/component/Properties/types';
import { Tooltip } from '@core/component/Tooltip';
import CircleDashed from '@icon/regular/circle-dashed.svg';

import { createMemo, For, Show } from 'solid-js';
import { PropertyPills } from './PropertyPills';

type KeyPropertiesGridProps = {
  properties: Property[];
};

const KEY_PROPERTY_ORDER = [
  SYSTEM_PROPERTY_IDS.STATUS,
  SYSTEM_PROPERTY_IDS.PRIORITY,
  SYSTEM_PROPERTY_IDS.ASSIGNEES,
];

/**
 * Grid layout for key task properties: Status, Priority, Assignees
 * Always shows 3 cells in a row, empty cells when property is not present
 * Uses regular PropertyPills with compressed=true for consistency
 */
export const KeyPropertiesGrid = (props: KeyPropertiesGridProps) => {
  const keyProperties = createMemo(() => {
    const propertyMap = new Map<string, Property>();
    for (const property of props.properties) {
      propertyMap.set(property.propertyDefinitionId, property);
    }

    return KEY_PROPERTY_ORDER.map((id) => propertyMap.get(id) || null);
  });

  return (
    <div class="grid grid-cols-[1fr_1fr_4fr] gap-2 w-fit">
      <For each={keyProperties()}>
        {(property, index) => (
          <div
            class="h-6 flex items-center"
            classList={{
              'w-6 justify-center': index() < 2, // Status and Priority get fixed width, centered
              'min-w-6 justify-start': index() === 2, // Assignees get flexible width, left aligned
            }}
          >
            <Show when={property}>
              {(prop) =>
                prop().value === null ? (
                  <PlaceholderPill property={prop()} index={index()} />
                ) : (
                  <PropertyPills properties={[prop()]} compressed={true} />
                )
              }
            </Show>
          </div>
        )}
      </For>
    </div>
  );
};

type PlaceholderPillProps = {
  property: Property;
  index: number;
};

const PlaceholderPill = (props: PlaceholderPillProps) => {
  return (
    <Tooltip
      unstyled
      tooltip={
        <div class="bg-panel border border-edge-muted text-xs text-ink-muted p-2">{`No ${props.property.displayName.toLowerCase()} set`}</div>
      }
      floatingOptions={{
        offset: 4,
        flip: true,
        shift: { padding: 8 },
      }}
    >
      <div
        class="inline-flex items-center justify-center text-xs leading-none text-ink-muted"
        classList={{
          'p-1.5': props.property.valueType !== 'ENTITY',
          'py-1.5 px-0.5': props.property.valueType === 'ENTITY',
        }}
      >
        <CircleDashed class="size-4 opacity-20" />
      </div>
    </Tooltip>
  );
};
