import {
  editorStateAsMarkdown,
  getSaveState,
} from '@core/component/LexicalMarkdown/utils';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { downloadFile } from '@filesystem/download';
import { createCallback } from '@solid-primitives/rootless';
import { useMarkdownDocument } from '../context/markdown-document-context';

export function useDownloadDocumentAsMarkdownText() {
  const { persistedName, fallbackName, state } = useMarkdownDocument();
  const fileName = () => persistedName() || fallbackName();

  return createCallback(() => {
    const editor = state.editor.md.editor;
    const runtime = state.editor.md.nativeRuntime;
    if (!editor && !runtime) return;

    const fileNameWithExtension = `${fileName()}.md`;
    const markdownString = runtime
      ? runtime.executor.session.markdown(1)
      : editor && editorStateAsMarkdown(editor, 'external');
    if (markdownString === undefined) return;

    const blob = new Blob([markdownString], { type: 'text/markdown' });
    fireAndForget(
      downloadFile(blob, fileNameWithExtension),
      'markdown-download'
    );
  });
}

export function useCopyDocumentAsMarkdown(options: { silent?: boolean } = {}) {
  const { state } = useMarkdownDocument();

  return createCallback(async () => {
    const editor = state.editor.md.editor;
    const runtime = state.editor.md.nativeRuntime;
    if (!editor && !runtime) return false;

    try {
      const markdown = runtime
        ? runtime.executor.session.markdown(1)
        : editor && editorStateAsMarkdown(editor, 'external');
      if (markdown === undefined) return false;
      await navigator.clipboard.writeText(markdown);
      if (!options.silent) toast.success('Markdown copied to clipboard');
      return true;
    } catch (error) {
      console.error('Failed to copy markdown', error);
      toast.failure('Failed to copy markdown');
      return false;
    }
  });
}

export function useDownloadDocumentAsJson() {
  const { persistedName, fallbackName, state } = useMarkdownDocument();
  const fileName = () => persistedName() || fallbackName();

  return createCallback(() => {
    const editor = state.editor.md.editor;
    const runtime = state.editor.md.nativeRuntime;
    if (!editor && !runtime) return;
    const fileNameWithExtension = `${fileName()}.json`;
    const json = runtime
      ? JSON.parse(runtime.executor.session.savedState())
      : editor && getSaveState(editor.getEditorState());
    const blob = new Blob([JSON.stringify(json, null, 2)], {
      type: 'application/json',
    });
    fireAndForget(
      downloadFile(blob, fileNameWithExtension),
      'markdown-download'
    );
  });
}
