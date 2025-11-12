import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import { useInlineEditor } from '../../hooks';
import type { Property } from '../../types';
import { formatPropertyValue } from '../../utils';

type TextValueProps = {
  property: Property;
  canEdit: boolean;
  entityType: EntityType;
  onRefresh?: () => void;
};

/**
 * Display component for string properties with inline editing
 */
export const TextValue: Component<TextValueProps> = (props) => {
  const editor = useInlineEditor(
    props.property,
    props.entityType,
    props.onRefresh
  );

  const supportsInline = () =>
    props.canEdit &&
    !props.property.isMetadata &&
    props.property.valueType === 'STRING';

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

  const displayValue = formatPropertyValue(
    props.property,
    props.property.value as string
  );

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
          } block max-w-full break-words`}
        >
          <Show
            when={
              !(
                !props.property.value ||
                (typeof props.property.value === 'string' &&
                  props.property.value.length === 0)
              )
            }
            fallback={<>-</>}
          >
            <span class="block max-w-full">{displayValue}</span>
          </Show>
        </button>
      }
    >
      <textarea
        ref={(el) => {
          setTimeout(() => {
            el.focus();
            el.setSelectionRange(el.value.length, el.value.length);
          }, 0);
        }}
        value={editor.inputValue()}
        onInput={(e) => editor.setInputValue(e.currentTarget.value)}
        onBlur={editor.save}
        onKeyDown={handleKeyDown}
        disabled={editor.isSaving()}
        class="w-full field-sizing-content resize-none text-left text-ink text-xs px-2 py-1 border border-edge bg-transparent focus:outline-none focus:border-accent"
      />
    </Show>
  );
};
