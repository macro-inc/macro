import DeleteIcon from '@icon/bold/x-bold.svg';
import { cn } from '@ui';
import type { Component } from 'solid-js';
import { createSignal, Show } from 'solid-js';
import { formatDate } from '../../utils';
import {
  EmptyValue,
  type PropertyValueProps,
  stubSaveHandler,
} from './ValueComponents';

/**
 * Display component for date properties
 * Opens date picker modal on click
 */
export const DateValue: Component<PropertyValueProps> = (props) => {
  const saveHandler = () => props.saveHandler ?? stubSaveHandler;
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
      await saveHandler().saveProperty(props.property, {
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
          'inline-flex items-center leading-none shrink-0 p-1.5 h-6.5 transition-colors border border-edge-muted',
          {
            'hover:border-edge-muted hover:bg-hover': props.canEdit,
          }
        )}
      >
        <Show when={displayValue} fallback={<EmptyValue />}>
          <span class="block truncate max-w-full">{displayValue}</span>
        </Show>
      </button>
      <Show when={!isReadOnly() && isHovered() && displayValue && !isSaving()}>
        <div class="absolute right-0 inset-y-0 flex items-center pr-1 pl-2 bg-linear-to-r from-transparent to-hover to-40%">
          <button
            onClick={handleDelete}
            disabled={isSaving()}
            class="size-4 p-0.5 flex items-center justify-center text-ink-muted hover:text-failure-ink"
          >
            <DeleteIcon class="size-3" />
          </button>
        </div>
      </Show>
    </div>
  );
};
