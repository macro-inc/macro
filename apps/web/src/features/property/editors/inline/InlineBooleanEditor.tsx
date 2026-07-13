import CheckIcon from '@phosphor/check.svg';
import { Show } from 'solid-js';
import { useProperty } from '../../core/context';
import { useBooleanEditor } from '../hooks/useBooleanEditor';

/**
 * Checkbox toggle for BOOLEAN properties. Saves immediately on click — no
 * editing mode. Treats null as unchecked.
 */
export function InlineBooleanEditor() {
  const ctx = useProperty();
  const { value, isSaving, toggle } = useBooleanEditor();

  const isReadOnly = () => ctx.property().isMetadata || !ctx.canEdit();
  const isChecked = () => !!value();

  return (
    <button
      type="button"
      onClick={() => !isReadOnly() && !isSaving() && toggle()}
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
          <CheckIcon class="size-3 text-surface" />
        </Show>
      </div>
    </button>
  );
}
