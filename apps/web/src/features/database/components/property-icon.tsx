import FunctionIcon from '@phosphor/function.svg';
import LinkIcon from '@phosphor/link-simple.svg';
import { PropertyDataTypeIcon } from '@property/utils/PropertyDataTypeIcon';
import { DataType } from '@service-properties/generated/schemas/dataType';
import { Show } from 'solid-js';
import type { DatabaseEntityType } from '../core/column-inference';

const dataTypes = new Set<string>(Object.values(DataType));
const isDataType = (type: string): type is DataType => dataTypes.has(type);

/** A column's type icon: the shared property icon, a link for relations, or ƒ for formulas. */
export function PropertyIcon(props: {
  type: string;
  entityType?: DatabaseEntityType | null;
  relation?: boolean;
  formula?: boolean;
  class?: string;
}) {
  const valueType = () => (isDataType(props.type) ? props.type : 'STRING');
  return (
    <span
      aria-hidden="true"
      class={props.class ?? 'size-3.5 shrink-0 text-ink-muted'}
    >
      <Show when={!props.formula} fallback={<FunctionIcon class="size-full" />}>
        <Show when={!props.relation} fallback={<LinkIcon class="size-full" />}>
          <PropertyDataTypeIcon
            property={{
              valueType: valueType(),
              specificEntityType: props.entityType,
            }}
            class="size-full"
          />
        </Show>
      </Show>
    </span>
  );
}
