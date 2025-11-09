import type { Component } from 'solid-js';
import type { Property } from '../../types';
import { formatDate } from '../../utils';

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

  // Empty state
  if (!props.property.value) {
    return (
      <button
        onClick={handleClick}
        class={`text-left text-xs px-2 py-1 border border-edge ${
          isReadOnly()
            ? 'bg-transparent text-ink-muted cursor-default'
            : 'hover:bg-hover cursor-pointer bg-transparent text-ink'
        } inline-block max-w-full`}
      >
        —
      </button>
    );
  }

  const displayValue = formatDate(props.property.value as Date);

  return (
    <button
      onClick={handleClick}
      class={`text-left text-xs px-2 py-1 border border-edge ${
        isReadOnly()
          ? 'bg-transparent text-ink-muted cursor-default'
          : 'hover:bg-hover cursor-pointer bg-transparent text-ink'
      } inline-block max-w-full break-words`}
      title={displayValue}
    >
      <span class="block truncate max-w-full">{displayValue}</span>
    </button>
  );
};
