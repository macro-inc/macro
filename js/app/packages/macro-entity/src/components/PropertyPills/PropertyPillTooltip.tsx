import type { Property } from '@core/component/Properties/types';
import { PropertyDataTypeIcon } from '@core/component/Properties/utils';
import type { ParentProps } from 'solid-js';

type PropertyPillTooltipProps = ParentProps<{
  property: Property;
}>;

/**
 * Shared tooltip content wrapper for property pills
 * Provides consistent header with icon and display name
 * Children are rendered as the values body
 */
export const PropertyPillTooltip = (props: PropertyPillTooltipProps) => {
  const singleSelect = () => !props.property.isMultiSelect;
  return (
    <div
      class="p-2 border border-edge-muted bg-panel"
      classList={{
        'flex flex-row gap-2 items-center': singleSelect(),
        'min-w-48 max-w-72': !singleSelect(),
      }}
    >
      <div
        class="flex items-center gap-2 text-ink-muted"
        classList={{
          'border-b border-edge-muted/50 pb-1.5 mb-1.5': !singleSelect(),
        }}
      >
        <PropertyDataTypeIcon
          property={{
            data_type: props.property.valueType,
            specific_entity_type:
              props.property.specificEntityType ?? undefined,
          }}
          class="size-3.5 text-ink-muted"
        />
        <span class="text-xs">{props.property.displayName}</span>
      </div>
      {props.children}
    </div>
  );
};
