import { useBlockId } from '@core/block';
import { IconButton } from '@core/component/IconButton';
import DeleteIcon from '@icon/bold/x-bold.svg';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { Component } from 'solid-js';
import { createSignal, For, Show } from 'solid-js';
import { savePropertyValue } from '../../api/propertyValues';
import { PROPERTY_STYLES } from '../../styles/propertyStyles';
import type { Property } from '../../types';
import { formatPropertyValue } from '../../utils';
import { AddPropertyValueButton, EmptyValue } from './ValueComponents';

type SelectValueProps = {
  property: Property;
  canEdit: boolean;
  entityType: EntityType;
  onEdit?: (property: Property, anchor?: HTMLElement) => void;
  onRefresh?: () => void;
};

/**
 * Display component for select_string and select_number properties
 * Opens options modal on click
 */
export const SelectValue: Component<SelectValueProps> = (props) => {
  const blockId = useBlockId();
  const [hoveredValue, setHoveredValue] = createSignal<string | null>(null);
  const [isSaving, setIsSaving] = createSignal(false);

  const handleClick = (e: MouseEvent) => {
    if (props.canEdit && !props.property.isMetadata) {
      props.onEdit?.(props.property, e.currentTarget as HTMLElement);
    }
  };

  const handleRemoveValue = async (valueToRemove: string) => {
    if (isReadOnly() || isSaving()) return;

    setIsSaving(true);

    try {
      const values = displayValues;
      const newValues = values.filter((v) => v !== valueToRemove);

      const valueType = props.property.valueType;
      if (valueType !== 'SELECT_STRING' && valueType !== 'SELECT_NUMBER') {
        return;
      }

      const result = await savePropertyValue(
        blockId,
        props.entityType,
        props.property,
        {
          valueType,
          values: newValues.length > 0 ? newValues : null,
        }
      );

      if (result.ok) {
        props.onRefresh?.();
      }
    } finally {
      setIsSaving(false);
    }
  };

  const isReadOnly = () => props.property.isMetadata || !props.canEdit;
  const displayValues = (props.property.value || []) as string[];

  return (
    <div
      class={`flex flex-wrap gap-1 justify-start items-start w-full min-w-0`}
    >
      <For each={displayValues}>
        {(value) => {
          const formatted = formatPropertyValue(props.property, value);
          const isHovered = () => hoveredValue() === value;
          return (
            <div
              class="relative inline-flex max-w-[140px] shrink-0"
              onMouseEnter={() => setHoveredValue(value)}
              onMouseLeave={() => setHoveredValue(null)}
            >
              <div class={PROPERTY_STYLES.value.multiButton} title={formatted}>
                <span class="block truncate">{formatted}</span>
              </div>
              <Show when={!isReadOnly() && isHovered() && !isSaving()}>
                <div class="absolute right-1 inset-y-0 flex items-center">
                  <IconButton
                    icon={DeleteIcon}
                    theme="clear"
                    size="xs"
                    class="!text-failure !bg-[#2a2a2a] hover:!bg-[#444444] !cursor-pointer !w-4 !h-4 !min-w-4 !min-h-4"
                    onClick={() => handleRemoveValue(value)}
                  />
                </div>
              </Show>
            </div>
          );
        }}
      </For>
      <Show
        when={!isReadOnly()}
        fallback={
          <Show when={displayValues.length === 0}>
            <div class="text-ink-muted text-xs px-2 py-1 border border-edge bg-transparent inline-block shrink-0">
              <EmptyValue />
            </div>
          </Show>
        }
      >
        <Show when={props.property.isMultiSelect || displayValues.length === 0}>
          <AddPropertyValueButton onClick={handleClick} />
        </Show>
      </Show>
    </div>
  );
};
