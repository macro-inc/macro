import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import type { Property } from '../../types';
import { formatDate } from '../../utils';
import { EmptyValue } from './ValueComponents';

type DateValueProps = {
  property: Property;
  canEdit: boolean;
  onEdit?: (property: Property, anchor?: HTMLElement) => void;
};

/**
 * Display component for date properties
 * Opens date picker modal on click
 */
export const DateValue: Component<DateValueProps> = (props) => {
  const handleClick = (e: MouseEvent) => {
    if (props.canEdit && !props.property.isMetadata) {
      props.onEdit?.(props.property, e.currentTarget as HTMLElement);
    }
  };

  const isReadOnly = () => props.property.isMetadata || !props.canEdit;

  const displayValue =
    props.property.value != null
      ? formatDate(props.property.value as Date)
      : '';

  return (
    <button
      onClick={handleClick}
      class="text-left px-2 py-0.5 border border-edge-muted bg-transparent inline-block max-w-full break-words shrink-0"
      classList={{
        'text-ink-muted cursor-default': isReadOnly(),
        'hover:bg-hover text-ink': !isReadOnly(),
      }}
    >
      <Show when={displayValue} fallback={<EmptyValue />}>
        <span class="block truncate max-w-full">{displayValue}</span>
      </Show>
    </button>
  );
};
