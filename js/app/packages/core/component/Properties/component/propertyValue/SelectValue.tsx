import DeleteIcon from '@icon/bold/x-bold.svg';
import type { Component } from 'solid-js';
import { createSignal, For, Show } from 'solid-js';
import { PROPERTY_STYLES } from '../../styles/styles';
import { formatPropertyValue, getSelectValues } from '../../utils';
import { PropertyValueIcon } from './PropertyValueIcon';
import {
  AddPropertyValueButton,
  EmptyValue,
  type PropertyValueProps,
  stubSaveHandler,
} from './ValueComponents';

/**
 * Display component for select_string and select_number properties
 * Opens options modal on click
 */
export const SelectValue: Component<PropertyValueProps> = (props) => {
  const saveHandler = () => props.saveHandler ?? stubSaveHandler;
  const [hoveredValue, setHoveredValue] = createSignal<string | null>(null);
  const [isSaving, setIsSaving] = createSignal(false);

  const handleClick = (e: MouseEvent) => {
    if (props.canEdit && !props.property.isMetadata) {
      e.stopPropagation();
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

      await saveHandler().saveProperty(props.property, {
        valueType,
        values: newValues.length > 0 ? newValues : null,
      });
      props.onRefresh?.();
    } catch {
      // Error toast is shown by mutation's onError callback
    } finally {
      setIsSaving(false);
    }
  };

  const isReadOnly = () => props.property.isMetadata || !props.canEdit;
  const displayValues = getSelectValues(props.property);

  return (
    <div class="flex flex-wrap gap-2 justify-start items-start w-full min-w-0">
      <For each={displayValues}>
        {(value) => {
          const formatted = formatPropertyValue(props.property, value);
          const isHovered = () => hoveredValue() === value;
          return (
            <div
              class="relative inline-flex max-w-35 shrink-0"
              onMouseEnter={() => setHoveredValue(value)}
              onMouseLeave={() => setHoveredValue(null)}
            >
              <div
                class={PROPERTY_STYLES.value.multiButton}
                title={formatted}
                onClick={
                  !props.property.isMultiSelect ? handleClick : undefined
                }
                style={{
                  cursor: 'default',
                }}
              >
                <PropertyValueIcon optionId={value} />
                <span class="block truncate">{formatted}</span>
              </div>
              <Show when={!isReadOnly() && isHovered() && !isSaving()}>
                <div class="absolute right-0 inset-y-0 flex items-center pr-1 pl-2 bg-linear-to-r from-transparent to-hover to-40%">
                  <button
                    onClick={() => handleRemoveValue(value)}
                    disabled={isSaving()}
                    class="size-4 p-0.5 flex items-center justify-center text-ink-muted hover:text-failure-ink"
                  >
                    <DeleteIcon class="size-3" />
                  </button>
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
            <div class="text-ink-muted px-2 py-0.5 border border-edge-muted bg-transparent inline-block shrink-0">
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
