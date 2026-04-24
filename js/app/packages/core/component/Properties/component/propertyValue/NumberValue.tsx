import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import { useInlineEditor } from '../../hooks';
import { formatNumber } from '../../utils';
import {
  EmptyValue,
  stubSaveHandler,
  type PropertyValueProps,
} from './ValueComponents';

/**
 * Display component for number properties with inline editing
 * Numbers are formatted to 4 decimal places
 */
export const NumberValue: Component<PropertyValueProps> = (props) => {
  const saveHandler = () => props.saveHandler ?? stubSaveHandler;
  const editor = useInlineEditor(
    props.property,
    saveHandler(),
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

  const hasValue = () => props.property.value != null;
  const displayValue = hasValue()
    ? formatNumber(props.property.value as number)
    : '';

  return (
    <Show
      when={editor.isEditing()}
      fallback={
        <button
          onClick={handleClick}
          class="text-left px-2 py-0.5 border border-edge-muted bg-transparent block max-w-full wrap-break-word cursor-default"
          classList={{
            'text-ink': supportsInline(),
            'text-ink-muted': !supportsInline(),
          }}
        >
          <Show when={hasValue()} fallback={<EmptyValue />}>
            <span class="block truncate max-w-full">{displayValue}</span>
          </Show>
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
        placeholder="Enter number..."
        class="w-full text-left text-ink px-2 py-0.5 border border-edge-muted bg-transparent focus:outline-none focus:border-accent"
      />
    </Show>
  );
};
