import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import { useInlineEditor } from '../../hooks';
import { formatPropertyValue } from '../../utils';
import {
  EmptyValue,
  type PropertyValueProps,
  stubSaveHandler,
} from './ValueComponents';

/**
 * Display component for string properties with inline editing
 */
export const TextValue: Component<PropertyValueProps> = (props) => {
  const saveHandler = () => props.saveHandler ?? stubSaveHandler;
  const editor = useInlineEditor(
    props.property,
    saveHandler(),
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

  const hasValue = () =>
    props.property.value != null &&
    typeof props.property.value === 'string' &&
    props.property.value.length > 0;

  return (
    <Show
      when={editor.isEditing()}
      fallback={
        <button
          onClick={handleClick}
          class="text-left px-2 py-0.5 border border-edge-muted bg-transparent block max-w-full break-words cursor-default"
          classList={{
            'text-ink': supportsInline(),
            'text-ink-muted': !supportsInline(),
          }}
        >
          <Show when={hasValue()} fallback={<EmptyValue />}>
            <span class="block max-w-full">
              {formatPropertyValue(
                props.property,
                props.property.value as string
              )}
            </span>
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
        placeholder={`Set ${props.property.displayName}...`}
        value={editor.inputValue()}
        onInput={(e) => editor.setInputValue(e.currentTarget.value)}
        onBlur={editor.save}
        onKeyDown={handleKeyDown}
        disabled={editor.isSaving()}
        class="w-full field-sizing-content resize-none text-left text-ink px-2 py-0.5 border border-edge-muted bg-transparent focus:outline-none focus:border-accent"
      />
    </Show>
  );
};
