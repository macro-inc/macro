import type { Component } from 'solid-js';
import { createSignal, Show } from 'solid-js';
import { usePropertiesContext } from '../../context/PropertiesContext';
import { formatDate } from '../../utils';
import {
  PropertyValueDeleteButton,
  type PropertyValueProps,
} from './ValueComponents';
import { cn } from '@ui/utils/classname';

/**
 * Display component for date properties
 * Opens date picker modal on click
 */
export const DateValue: Component<PropertyValueProps> = (props) => {
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
      await saveHandler.saveProperty(props.property, {
        valueType: 'DATE',
        value: null,
      });
      props.onRefresh?.();
    } catch {
      // Error toast is shown by mutation's onError callback
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
        class={cn(
          'inline-flex items-center text-xs leading-none text-ink-muted shrink-0 py-1.5 h-6.5 transition-colors border border-edge-muted/50 px-1.5',
          {
            'cursor-pointer hover:border-edge-muted hover:bg-hover/50':
              props.canEdit,
            'opacity-50': !displayValue,
          }
        )}
      >
        <Show
          when={displayValue}
          fallback={<span class="opacity-20">Due Date</span>}
        >
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
