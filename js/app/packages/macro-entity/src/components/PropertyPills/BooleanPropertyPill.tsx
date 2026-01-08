import type { Property } from '@core/component/Properties/types';
import { PropertyDataTypeIcon } from '@core/component/Properties/utils';
import { Tooltip } from '@core/component/Tooltip';

import { PropertyPillTooltip } from './PropertyPillTooltip';

type BooleanPropertyPillProps = {
  property: Property & { valueType: 'BOOLEAN' };
  compressed?: boolean;
};

/**
 * Pill for boolean properties
 * Only shows when value is true (false = no pill displayed)
 */
export const BooleanPropertyPill = (props: BooleanPropertyPillProps) => {
  // Don't show pill for false or null values
  if (!props.property.value) return null;

  return (
    <Tooltip
      tooltip={<BooleanTooltipContent property={props.property} />}
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
            data_type: 'BOOLEAN',
          }}
          class="size-3.5 shrink-0"
        />
        <span
          class="truncate max-w-[120px] hidden"
          classList={{
            '@3xl/soup:inline': !props.compressed,
          }}
        >
          {props.property.displayName}
        </span>
      </div>
    </Tooltip>
  );
};

const BooleanTooltipContent = (props: {
  property: Property & { valueType: 'BOOLEAN' };
}) => {
  return (
    <PropertyPillTooltip property={props.property}>
      <div class="flex items-center gap-1.5 flex-wrap">
        <div class="inline-flex items-center px-2 py-1 text-xs leading-none text-ink-muted border border-edge-muted h-fit w-fit">
          <span>True</span>
        </div>
      </div>
    </PropertyPillTooltip>
  );
};
