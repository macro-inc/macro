import { createRoot } from 'solid-js';
import type {
  EmailComposeContext,
  EmailComposeHost,
} from '../context/compose-capabilities';
import { createEmailComposer } from '../primitives/email-composer';
import { createEmailEditor, setEmailEditorText } from './editor';

/** A blank, addressed composer with a real editor and the normal initialization callback. */
export function mountEmailComposer(
  context: EmailComposeContext,
  host?: EmailComposeHost
) {
  const root = createRoot((dispose) => ({
    dispose,
    state: createEmailComposer({
      ...context,
      initialTo: ['colleague@example.com'],
      host,
    }),
  }));
  const editor = createEmailEditor();
  root.state.context.captureEditor(editor);
  root.state.context.onContentChange('');
  return {
    ...root,
    edit(text: string, subject = 'Review') {
      setEmailEditorText(editor, text);
      root.state.context.setSubject(subject);
      root.state.context.onContentChange(text);
    },
  };
}
