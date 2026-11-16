import { Show } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import {
  ComposerDescriptionEditor,
  type ComposerDescriptionEditorProps,
} from './ComposerDescriptionEditor';

export function ComposerDescription(
  props: Omit<ComposerDescriptionEditorProps, 'initialValue'>
) {
  const model = useCalendarComposer();
  const initialValue = model.state().description;
  // A permission refusal resets the model; remount its editor with the reset value.
  const editorIdentity = () =>
    model.fieldIsReadOnly('description') ? 'locked' : 'editable';
  return (
    <Show keyed when={editorIdentity()}>
      {(_identity) => (
        <ComposerDescriptionEditor {...props} initialValue={initialValue} />
      )}
    </Show>
  );
}
