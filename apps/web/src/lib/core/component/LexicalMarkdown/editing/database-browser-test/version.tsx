import '@app/index.css';
import { MarkdownEditorChrome } from '@block-md/component/MarkdownEditorChrome';
import { fireAndForget } from '@core/util/fireAndForget';
import { Access } from '@macro-inc/collaboration/session/abi.generated';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import * as native from '../../../../document-session/wasm/document_session_wasm';
import {
  getErrorDescription,
  type MarkdownEditorErrors,
} from '../../constants';
import { mountNewerDocumentFixture } from '../../plugins/document-metadata/browser-test/native-fixture';
import { nativeDocumentMetadataError } from '../../plugins/document-metadata/native';

await native.default();
const name = new URL(location.href).searchParams.get('access');
const access =
  name === 'read'
    ? Access.Read
    : name === 'comment'
      ? Access.CommentOnly
      : Access.Edit;
const [error, setError] = createSignal<MarkdownEditorErrors>();
const description = () => {
  const value = error();
  return value ? getErrorDescription(value) : undefined;
};
const root = document.createElement('div');
root.setAttribute('role', 'textbox');
root.setAttribute('aria-label', 'Document body');
const chrome = document.getElementById('chrome');
if (!chrome) throw new Error('Missing chrome');
const release = render(
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
const runtime = mountNewerDocumentFixture(root, native, access, (cause) => {
  const versionError = nativeDocumentMetadataError(cause);
  if (!versionError) throw cause;
  setError(versionError);
});
if (!error() || !runtime.view.node(0))
  throw new Error('Newer open was not blocked');
document.documentElement.dataset.ready = 'true';
window.addEventListener(
  'pagehide',
  () => {
    release();
    fireAndForget(runtime.close(), 'editor.version-fixture.close');
  },
  { once: true }
);
