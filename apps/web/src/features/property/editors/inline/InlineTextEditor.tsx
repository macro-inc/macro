import { type JSX, Show } from 'solid-js';
import { useProperty } from '../../core/context';
import { PropertyEmpty } from '../../extractors/PropertyEmpty';
import { formatPropertyValue } from '../../utils';
import { useInlineEditor } from '../hooks/useInlineEditor';

/**
 * Click-to-edit textarea for STRING properties. In display mode renders as a
 * button (matches existing CondensedPropertyValue / panel pill look); editing
 * mode swaps to a field-sizing textarea that grows with content.
 */
export function InlineTextEditor(props: { emptyValue?: JSX.Element }) {
  const ctx = useProperty();
  const editor = useInlineEditor();

  const property = () => ctx.property();
  const supportsInline = () =>
    ctx.canEdit() &&
    !property().isMetadata &&
    property().valueType === 'STRING';

  const hasValue = () => {
    const v = property().value;
    return typeof v === 'string' && v.length > 0;
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
          <Show
            when={hasValue()}
            fallback={props.emptyValue ?? <PropertyEmpty label="Empty" />}
          >
            <span class="block max-w-full">
              {formatPropertyValue(property(), property().value as string)}
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
        placeholder={`Set ${property().displayName}...`}
        value={editor.inputValue()}
        onInput={(e) => editor.setInputValue(e.currentTarget.value)}
        onBlur={editor.save}
        onKeyDown={editor.handleKeyDown}
        readOnly={editor.isSaving()}
        class="w-full field-sizing-content resize-none text-left text-ink px-2 py-0.5 bg-transparent focus:outline-none rounded-sm"
      />
    </Show>
  );
}
