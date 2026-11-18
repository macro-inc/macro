import { createMemo, Show } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import {
  ComposerDescriptionEditor,
  type ComposerDescriptionEditorProps,
} from './ComposerDescriptionEditor';

export function ComposerDescription(
  props: Omit<ComposerDescriptionEditorProps, 'initialValue'>
) {
  const model = useCalendarComposer();
  // External seeds and permission changes remount Lexical. Ordinary typing
  // changes only the current value, so it keeps the editor and its caret intact.
  const editorIdentity = createMemo(() => ({
    initialValue: model.controller.initialValue().description,
    readOnly: model.fieldIsReadOnly('description'),
  }));
  return (
    <Show keyed when={editorIdentity()}>
      {(_identity) => (
        <ComposerDescriptionEditor
          {...props}
          initialValue={model.state().description}
        />
      )}
    </Show>
  );
}
