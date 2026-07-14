import { Show } from 'solid-js';
import { useProperty } from '../../core/context';
import { PropertyEmpty } from '../../extractors/PropertyEmpty';
import { formatNumber } from '../../utils';
import { useInlineEditor } from '../hooks/useInlineEditor';

/**
 * Click-to-edit number input. Step 0.0001 matches the existing
 * NUMBER_DECIMAL_PLACES rounding the save path applies.
 */
export function InlineNumberEditor() {
  const ctx = useProperty();
  const editor = useInlineEditor();

  const property = () => ctx.property();
  const supportsInline = () =>
    ctx.canEdit() &&
    !property().isMetadata &&
    property().valueType === 'NUMBER';

  const hasValue = () => property().value != null;
  const display = () =>
    hasValue() ? formatNumber(property().value as number) : '';

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      editor.save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      editor.cancelEdit();
    }
  };

  return (
    <Show
      when={editor.isEditing()}
      fallback={
        <button
          type="button"
          onClick={() => supportsInline() && editor.startEdit()}
          class="text-left px-2 py-0.5 bg-transparent block max-w-full wrap-break-word cursor-default rounded-sm"
          classList={{
            'text-ink': supportsInline(),
            'text-ink-muted': !supportsInline(),
          }}
        >
          <Show when={hasValue()} fallback={<PropertyEmpty label="Empty" />}>
            <span class="block truncate max-w-full">{display()}</span>
          </Show>
        </button>
      }
    >
      <input
        ref={(el) => setTimeout(() => el.focus(), 0)}
        type="number"
        step="0.0001"
        value={editor.inputValue()}
        onInput={(e) => editor.setInputValue(e.currentTarget.value)}
        onBlur={editor.save}
        onKeyDown={handleKeyDown}
        disabled={editor.isSaving()}
        placeholder="Enter number..."
        class="w-full text-left text-ink px-2 py-0.5 bg-transparent focus:outline-none rounded-sm"
      />
    </Show>
  );
}
