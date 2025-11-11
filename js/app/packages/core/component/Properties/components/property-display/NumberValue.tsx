import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import { useInlineEditor } from '../../hooks';
import type { Property } from '../../types';
import { formatNumber } from '../../utils';

type NumberValueProps = {
  property: Property;
  canEdit: boolean;
  entityType: EntityType;
  onRefresh?: () => void;
};

/**
 * Display component for number properties with inline editing
 * Numbers are formatted to 4 decimal places
 */
export const NumberValue: Component<NumberValueProps> = (props) => {
  const editor = useInlineEditor(
    props.property,
    props.entityType,
    props.onRefresh
  );

  const supportsInline = () =>
    props.canEdit &&
    !props.property.isMetadata &&
    props.property.valueType === 'NUMBER';

  const handleClick = () => {
    if (supportsInline()) {
      editor.startEdit();
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      editor.save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      editor.cancelEdit();
    }
  };

  // Empty state
  if (props.property.value === undefined || props.property.value === null) {
    return (
      <Show
        when={editor.isEditing()}
        fallback={
          <button
            onClick={handleClick}
            class={`text-left text-xs px-2 py-1 border border-edge ${
              supportsInline()
                ? 'hover:bg-hover cursor-pointer bg-transparent text-ink'
                : 'bg-transparent text-ink-muted cursor-default'
            } inline-block max-w-full`}
          >
            —
          </button>
        }
      >
        <input
          ref={(el) => {
            setTimeout(() => {
              el.focus();
              el.setSelectionRange(el.value.length, el.value.length);
            }, 0);
          }}
          type="number"
          step="0.0001"
          value={editor.inputValue()}
          onInput={(e) => editor.setInputValue(e.currentTarget.value)}
          onBlur={editor.save}
          onKeyDown={handleKeyDown}
          disabled={editor.isSaving()}
          placeholder="Enter number..."
          class="w-full text-left text-ink text-xs px-2 py-1 border border-edge bg-transparent focus:outline-none focus:border-accent"
        />
      </Show>
    );
  }

  const displayValue = formatNumber(props.property.value as number);

  return (
    <Show
      when={editor.isEditing()}
      fallback={
        <button
          onClick={handleClick}
          class={`text-left text-xs px-2 py-1 border border-edge ${
            supportsInline()
              ? 'hover:bg-hover cursor-pointer bg-transparent text-ink'
              : 'bg-transparent text-ink-muted cursor-default'
          } inline-block max-w-full break-words`}
          title={displayValue}
        >
          <span class="block truncate max-w-full">{displayValue}</span>
        </button>
      }
    >
      <input
        ref={(el) => {
          setTimeout(() => {
            el.focus();
          }, 0);
        }}
        type="number"
        step="0.0001"
        value={editor.inputValue()}
        onInput={(e) => editor.setInputValue(e.currentTarget.value)}
        onBlur={editor.save}
        onKeyDown={handleKeyDown}
        disabled={editor.isSaving()}
        class="w-full text-left text-ink text-xs px-2 py-1 border border-edge bg-transparent focus:outline-none focus:border-accent"
      />
    </Show>
  );
};
