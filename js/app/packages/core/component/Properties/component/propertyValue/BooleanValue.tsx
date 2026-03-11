import CheckIcon from '@icon/bold/check-bold.svg';
import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import { useBooleanEditor } from '../../hooks';
import type { Property } from '../../types';
import { stubSaveHandler, type PropertyValueProps } from './ValueComponents';

/**
 * Display component for boolean properties with instant toggle
 * Treats null as false (unchecked)
 */
export const BooleanValue: Component<PropertyValueProps> = (props) => {
  const saveHandler = () => props.saveHandler ?? stubSaveHandler;

  const { value, isSaving, toggle } = useBooleanEditor(
    props.property as Property & { valueType: 'BOOLEAN' },
    saveHandler(),
    props.onRefresh
  );

  const isReadOnly = () => props.property.isMetadata || !props.canEdit;

  // Treat null as false - use !! to convert any truthy value to boolean
  const isChecked = () => !!value();

  const handleClick = () => {
    if (!isReadOnly() && !isSaving()) {
      toggle();
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={isSaving() || isReadOnly()}
      class="flex items-center justify-end p-1"
      classList={{
        'cursor-default': isReadOnly() || isSaving(),
        'hover:bg-hover': !isReadOnly() && !isSaving(),
      }}
    >
      <div
        class="size-4 flex items-center justify-center"
        classList={{
          'bg-accent border-accent border': isChecked(),
          'bg-transparent border-edge-muted border': !isChecked(),
        }}
      >
        <Show when={isChecked()}>
          <CheckIcon class="size-3 text-panel" />
        </Show>
      </div>
    </button>
  );
};
