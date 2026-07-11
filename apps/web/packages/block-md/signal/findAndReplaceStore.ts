import { createBlockStore } from '@core/block';
import type { NodekeyOffset } from '@core/component/LexicalMarkdown/plugins';
import type { FloatingStyle } from '@core/component/LexicalMarkdown/plugins/find-and-replace';

// Store Variables
interface FindAndReplaceStore {
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
const initialState: FindAndReplaceStore = {
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

// Create the store
export const FindAndReplaceStore =
  createBlockStore<FindAndReplaceStore>(initialState);
