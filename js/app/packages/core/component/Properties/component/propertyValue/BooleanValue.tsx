import CheckIcon from '@icon/bold/check-bold.svg';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import { useBooleanEditor } from '../../hooks';
import type { Property } from '../../types';

type BooleanValueProps = {
  property: Property;
  canEdit: boolean;
  entityType: EntityType;
  onRefresh?: () => void;
};

/**
 * Display component for boolean properties with instant toggle
 * Treats undefined as false (unchecked)
 */
export const BooleanValue: Component<BooleanValueProps> = (props) => {
  const { value, isSaving, toggle } = useBooleanEditor(
    props.property as Property & { valueType: 'boolean' },
    props.entityType,
    props.onRefresh
  );

  const isReadOnly = () => props.property.isMetadata || !props.canEdit;

  // Treat undefined/null as false
  const isChecked = () => value() === true;

  const handleClick = () => {
    if (!isReadOnly() && !isSaving()) {
      toggle();
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={isSaving() || isReadOnly()}
      class={`flex items-center justify-end ${
        isReadOnly() ? 'cursor-default' : 'hover:bg-hover cursor-pointer'
      } ${isSaving() ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <div class="w-6 h-6 border border-edge bg-transparent flex items-center justify-center">
        <Show when={isChecked()}>
          <CheckIcon class="w-4.5 h-4.5 text-accent" />
        </Show>
      </div>
    </button>
  );
};
