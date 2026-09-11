import type { NodekeyOffset } from '@core/component/LexicalMarkdown/plugins';
import type { FloatingStyle } from '@core/component/LexicalMarkdown/plugins/find-and-replace';
import { useMarkdownDocument } from '../context/markdown-document-context';

// Store Variables
export interface FindAndReplaceState {
  searchIsOpen: boolean;

  isSearching: boolean;
  searchInputText: string;

  replaceInputOpen: boolean;
  replaceInputText: string;

  listOffset: NodekeyOffset[];
  styles: { style: FloatingStyle; idx: number | undefined }[];
  matches: number;

  currentMatch: number;
  currentQuery: string;
}

// Initial state
export const initialFindAndReplaceState: FindAndReplaceState = {
  searchIsOpen: false,

  isSearching: false,
  searchInputText: '',

  replaceInputOpen: false,
  replaceInputText: '',

  listOffset: [],
  styles: [],
  matches: 0,

  currentMatch: -1,
  currentQuery: '',
};

export function useFindAndReplaceStore() {
  const { findAndReplace, setFindAndReplace } =
    useMarkdownDocument().state.editor;
  return [findAndReplace, setFindAndReplace] as const;
}
