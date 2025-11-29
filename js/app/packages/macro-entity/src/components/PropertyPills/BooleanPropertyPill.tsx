import type { Property } from '@core/component/Properties/types';
import { PropertyDataTypeIcon } from '@core/component/Properties/utils';
import { Tooltip } from '@core/component/Tooltip';
import { cornerClip } from '@core/util/clipPath';
import { PropertyPillTooltip } from './PropertyPillTooltip';

type BooleanPropertyPillProps = {
  property: Property & { valueType: 'BOOLEAN' };
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
        class="p-px bg-edge box-border h-fit flex items-center"
        style={{ 'clip-path': cornerClip('0.2rem', 0, 0, 0) }}
      >
        <div
          class="inline-flex items-center gap-1.5 p-1.5 @3xl/soup:px-2 @3xl/soup:py-1 text-xs leading-none text-ink-muted bg-panel box-border"
          style={{ 'clip-path': cornerClip('calc(0.2rem - 0.5px)', 0, 0, 0) }}
        >
          <PropertyDataTypeIcon
            property={{
              data_type: 'BOOLEAN',
            }}
            class="size-3.5 shrink-0"
          />
          <span class="truncate max-w-[120px] hidden @3xl/soup:inline">
            {props.property.displayName}
          </span>
        </div>
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
        <div
          class="p-px bg-edge box-border h-fit w-fit flex items-center"
          style={{ 'clip-path': cornerClip('0.2rem', 0, 0, 0) }}
        >
          <div
            class="inline-flex items-center px-2 py-1 text-xs leading-none text-ink-muted bg-panel box-border"
            style={{ 'clip-path': cornerClip('calc(0.2rem - 0.5px)', 0, 0, 0) }}
          >
            <span>True</span>
          </div>
        </div>
      </div>
    </PropertyPillTooltip>
  );
};
