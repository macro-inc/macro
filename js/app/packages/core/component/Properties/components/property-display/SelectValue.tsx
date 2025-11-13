import type { Component } from 'solid-js';
import { For, Show } from 'solid-js';
import { PROPERTY_STYLES } from '../../styles/propertyStyles';
import type { Property } from '../../types';
import { formatPropertyValue } from '../../utils';

type SelectValueProps = {
  property: Property;
  canEdit: boolean;
  onEdit?: (property: Property, anchor?: HTMLElement) => void;
};

/**
 * Display component for select_string and select_number properties
 * Opens options modal on click
 */
export const SelectValue: Component<SelectValueProps> = (props) => {
  const handleClick = (e: MouseEvent) => {
    if (props.canEdit && !props.property.isMetadata) {
      props.onEdit?.(props.property, e.currentTarget as HTMLElement);
    }
  };

  const isReadOnly = () => props.property.isMetadata || !props.canEdit;
  const displayValues = (props.property.value || []) as string[];
  const isMultiValue = () => props.property.isMultiSelect;

  return (
    <Show
      when={isMultiValue()}
      fallback={
        <button
          onClick={handleClick}
          class={`text-left text-xs px-2 py-1 border border-edge ${
            isReadOnly()
              ? 'bg-transparent text-ink-muted cursor-default'
              : 'hover:bg-hover cursor-pointer bg-transparent text-ink'
          } inline-block max-w-full break-words`}
        >
          <Show when={displayValues.length > 0} fallback={<>—</>}>
            <span class="block truncate max-w-full">
              {formatPropertyValue(props.property, displayValues[0])}
            </span>
          </Show>
        </button>
      }
    >
      <div
        class={`flex flex-wrap gap-1 justify-start items-start w-full min-w-0`}
      >
        <For each={displayValues}>
          {(value) => {
            const formatted = formatPropertyValue(props.property, value);
            return (
              <Show
                when={isReadOnly()}
                fallback={
                  <button
                    onClick={handleClick}
                    class={PROPERTY_STYLES.value.multiButton}
                    title={formatted}
                  >
                    <span class="block truncate">{formatted}</span>
                  </button>
                }
              >
                <div
                  class={`${PROPERTY_STYLES.value.multi} text-ink-muted`}
                  title={formatted}
                >
                  <span class="block truncate">{formatted}</span>
                </div>
              </Show>
            );
          }}
        </For>
        <Show when={!isReadOnly()}>
          <button
            onClick={handleClick}
            class="text-ink-muted hover:text-ink text-xs hover:bg-hover px-2 py-1 cursor-pointer border border-edge bg-transparent inline-block shrink-0"
          >
            +
          </button>
        </Show>
      </div>
    </Show>
  );
};
