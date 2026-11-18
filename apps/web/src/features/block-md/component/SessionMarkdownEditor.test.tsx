import { MarkdownEditorErrors } from '@core/component/LexicalMarkdown/constants';
import { fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import SessionMarkdownEditor from './SessionMarkdownEditor';

const [versionError, setVersionError] = createSignal<MarkdownEditorErrors>();
vi.mock('../context/markdown-document-context', () => ({
  useMarkdownDocument: () => ({
    permissions: { canEdit: () => true },
    state: { editor: { error: versionError, setMd() {} } },
  }),
}));
vi.mock('@core/document-session/editor-engine', () => ({
  EditorEngineBoundary: (props: { children: import('solid-js').JSX.Element }) =>
    props.children,
}));
vi.mock('./RustMarkdownEditor', () => ({
  default: () => (
    <button
      onClick={() =>
        setVersionError(MarkdownEditorErrors.VERSION_MISMATCH_ERROR)
      }
    >
      Newer document received
    </button>
  ),
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/core/FocusClickTarget',
  () => ({ FocusClickTarget: () => null })
);

it('shows the Source version-mismatch guidance in the native document chrome', () => {
  setVersionError(undefined);
  const rendered = render(() => (
    <SessionMarkdownEditor
      context={{
        syncService: true,
        fromCache: false,
        documentMetadata: {
          documentId: 'fixture-document',
          documentName: 'Fixture',
          documentVersionId: 1,
          owner: 'fixture-user',
          fileType: 'md',
        },
        userAccessLevel: 'edit',
      }}
      autoFocus={false}
    />
  ));
  fireEvent.click(rendered.getByText('Newer document received'));
  expect(
    rendered.getByText(
      'Refresh the page to edit this document. It may have been updated using a newer version of Macro.'
    )
  ).toBeTruthy();
  rendered.unmount();
});
