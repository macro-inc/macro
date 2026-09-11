import { useMarkdownDocument } from '../context/markdown-document-context';

export function useCommentState() {
  return useMarkdownDocument().state.comments;
}
