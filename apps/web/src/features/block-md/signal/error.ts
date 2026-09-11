import { useMarkdownDocument } from '../context/markdown-document-context';

export function useMarkdownBlockError() {
  const { error, setError } = useMarkdownDocument().state.editor;
  return [error, setError] as const;
}
