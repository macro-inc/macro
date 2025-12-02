import type { Property } from '@core/component/Properties/types';
import { PropertyDataTypeIcon } from '@core/component/Properties/utils';
import { cornerClip } from '@core/util/clipPath';
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
  return (
    <div
      class="-m-1.5 p-[0.5px] bg-edge box-border"
      style={{ 'clip-path': cornerClip('0.2rem', 0, 0, 0) }}
    >
      <div
        class="flex flex-col gap-2 p-2 bg-menu min-w-[240px] max-w-[280px] box-border"
        style={{ 'clip-path': cornerClip('calc(0.2rem - 0.5px)', 0, 0, 0) }}
      >
        <div class="flex items-center gap-2 text-ink-muted pb-1.5 border-b border-edge/50">
          <PropertyDataTypeIcon
            property={{
              data_type: props.property.valueType,
              specific_entity_type:
                props.property.specificEntityType ?? undefined,
            }}
            class="size-3.5 text-ink-muted"
          />
          <span class="text-sm font-semibold">
            {props.property.displayName}
          </span>
        </div>
        {props.children}
      </div>
    </div>
  );
};
