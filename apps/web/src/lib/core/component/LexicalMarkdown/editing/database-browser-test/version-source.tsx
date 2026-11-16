import '@app/index.css';
import { MarkdownEditorChrome } from '@block-md/component/MarkdownEditorChrome';
import { registerRichText } from '@lexical/rich-text';
import { createRoot, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import {
  getErrorDescription,
  type MarkdownEditorErrors,
} from '../../constants';
import { createLexicalWrapper } from '../../context/LexicalWrapperContext';
import { documentMetadataPlugin } from '../../plugins/document-metadata/documentMetadataPlugin';
import { initializeEditorWithVersionedState } from '../../utils';
import { MARKDOWN_VERSION_COUNTER } from '../../version';

const close = createRoot((disposeOwner) => {
  const [error, setError] = createSignal<MarkdownEditorErrors>();
  const wrapper = createLexicalWrapper({
    type: 'markdown-sync',
    namespace: 'source-version-fixture',
    withIds: true,
    isInteractable: () => false,
  });
  const root = document.createElement('div');
  root.setAttribute('role', 'textbox');
  root.setAttribute('aria-label', 'Document body');
  root.contentEditable = 'false';
  root.tabIndex = 0;
  const chrome = document.getElementById('chrome');
  if (!chrome) throw new Error('Missing chrome');
  const description = () => {
    const value = error();
    return value ? getErrorDescription(value) : undefined;
  };
  const dispose = render(
    () => (
      <MarkdownEditorChrome
        ready={false}
        empty={false}
        canEdit={false}
        error={description()}
        body={root}
        focusTarget={null}
      />
    ),
    chrome
  );
  wrapper.editor.setRootElement(root);
  wrapper.editor.setEditable(false);
  const rich = registerRichText(wrapper.editor);
  const metadata = documentMetadataPlugin({ onVersionError: setError })(
    wrapper.editor
  );
  return {
    wrapper,
    setError,
    close() {
      metadata();
      rich();
      wrapper.cleanup();
      wrapper.editor.setRootElement(null);
      dispose();
      disposeOwner();
    },
  };
});
// Like the app's asynchronous load, let plugin registration settle first.
await Promise.resolve();
await Promise.resolve();
const state = close.wrapper.editor.getEditorState().toJSON();
const text = {
  type: 'text',
  version: 1,
  text: 'Before',
  format: 0,
  detail: 0,
  mode: 'normal',
  style: '',
};
const paragraph = {
  type: 'paragraph',
  version: 1,
  children: [text],
  direction: null,
  format: '',
  indent: 0,
  textFormat: 0,
  textStyle: '',
};
const loaded = initializeEditorWithVersionedState(close.wrapper.editor, {
  ...state,
  root: {
    ...state.root,
    children: [paragraph],
    $: {
      documentMetadata: {
        version: MARKDOWN_VERSION_COUNTER + 1,
        environmentTags: null,
      },
    },
  },
});
if (!loaded) throw new Error('Source did not reject the newer version');
close.setError(loaded);
await Promise.resolve();
await Promise.resolve();
document.documentElement.dataset.ready = 'true';
window.addEventListener('pagehide', close.close, { once: true });
