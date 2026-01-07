import type { Component } from 'solid-js';
import { createSignal, Show } from 'solid-js';
import { usePropertiesContext } from '../../context/PropertiesContext';
import type { Property } from '../../types';
import { formatDate } from '../../utils';
import { ERROR_MESSAGES, handlePropertyError } from '../../utils/errorHandling';
import { EmptyValue, PropertyValueDeleteButton } from './ValueComponents';

type DateValueProps = {
  property: Property;
  canEdit: boolean;
  onEdit?: (property: Property, anchor?: HTMLElement) => void;
  onRefresh?: () => void;
};

/**
 * Display component for date properties
 * Opens date picker modal on click
 */
export const DateValue: Component<DateValueProps> = (props) => {
  const { saveHandler } = usePropertiesContext();
  const [isHovered, setIsHovered] = createSignal(false);
  const [isSaving, setIsSaving] = createSignal(false);

  const handleClick = (e: MouseEvent) => {
    if (props.canEdit && !props.property.isMetadata) {
      props.onEdit?.(props.property, e.currentTarget as HTMLElement);
    }
  };

  const handleDelete = async () => {
    if (isReadOnly() || isSaving()) return;

    setIsSaving(true);

    try {
      const result = await saveHandler.saveProperty(props.property, {
        valueType: 'DATE',
        value: null,
      });

      if (
        handlePropertyError(
          result,
          ERROR_MESSAGES.PROPERTY_SAVE,
          'DateValue.handleDelete'
        )
      ) {
        props.onRefresh?.();
      }
    } finally {
      setIsSaving(false);
    }
  };

  const isReadOnly = () => props.property.isMetadata || !props.canEdit;

  const displayValue =
    props.property.value != null
      ? formatDate(props.property.value as Date)
      : '';

  return (
    <div
      class="relative inline-flex max-w-full shrink-0"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <button
        onClick={handleClick}
        class="text-left px-2 py-0.5 border border-edge-muted bg-transparent inline-block max-w-full break-words shrink-0"
        classList={{
          'text-ink-muted cursor-default': true,
        }}
      >
        <Show when={displayValue} fallback={<EmptyValue />}>
          <span class="block truncate max-w-full">{displayValue}</span>
        </Show>
      </button>
      <Show when={!isReadOnly() && isHovered() && displayValue && !isSaving()}>
        <div class="absolute right-1 inset-y-0 flex items-center">
          <PropertyValueDeleteButton
            onClick={handleDelete}
            disabled={isSaving()}
          />
        </div>
      </Show>
    </div>
  );
};
