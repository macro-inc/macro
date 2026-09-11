import type { MarkdownEditorErrors } from '@core/component/LexicalMarkdown/constants';
import type {
  Completion,
  GenerateMenuOpen,
  NodekeyOffset,
  PluginManager,
  ProgressStats,
  SelectionData,
  WordcountStats,
} from '@core/component/LexicalMarkdown/plugins';
import type { FloatingStyle } from '@core/component/LexicalMarkdown/plugins/find-and-replace';
import { createParamsState } from '@core/component/ParamsProvider';
import type { NodeIdMappings } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import type { LexicalEditor } from 'lexical';
import { createSignal } from 'solid-js';
import { createStore, type Store } from 'solid-js/store';
import type {
  CommentStore,
  MarkStore,
  ThreadStore,
} from '../comments/commentType';
import type { Diff } from '../types';

type MdData = {
  editor?: LexicalEditor;
  /** Durable nodeId <-> nodeKey mapping for the main editor (from the nodeId plugin). */
  mapping?: NodeIdMappings;
  titleEditor?: LexicalEditor;
  plugins?: PluginManager;
  selection?: Store<SelectionData>;
  wordcountStats?: Store<WordcountStats>;
  progressStats?: Store<ProgressStats>;
  notebook?: HTMLElement;
  scrollContainer?: HTMLElement;
  commentMargin?: HTMLElement;
  contentRef?: HTMLElement;
  locationReady?: boolean;
};

type FindAndReplaceState = {
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
};

const initialFindAndReplaceState: FindAndReplaceState = {
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

type MarkdownCommentsState = {
  marks: MarkStore;
  activeMarkIds: string[];
  activeCommentThread: number | null;
  highlightedCommentId: number | null;
  comments: CommentStore;
  threads: ThreadStore;
  commentMarksInitialized: boolean;
  highlightedCommentThreads: number[];
};

export function createMarkdownDocumentState() {
  const params = createParamsState();
  const [md, setMd] = createStore<MdData>({});
  const [error, setError] = createSignal<MarkdownEditorErrors | null>(null);
  const [findAndReplace, setFindAndReplace] = createStore<FindAndReplaceState>(
    structuredClone(initialFindAndReplaceState)
  );

  const [rewriting, setRewriting] = createSignal(false);
  const [revisions, setRevisions] = createSignal<Diff[]>();

  const [isGenerating, setIsGenerating] = createSignal(false);
  const [generatedAndWaiting, setGeneratedAndWaiting] = createSignal(false);
  const [completion, setCompletion] = createSignal<Completion>();
  const [generateMenuOpen, setGenerateMenuOpen]: GenerateMenuOpen =
    createSignal<boolean>();
  const [generateContext, setGenerateContext] = createSignal<string>();

  const [comments, setCommentState] = createStore<MarkdownCommentsState>({
    marks: {},
    activeMarkIds: [],
    activeCommentThread: null,
    highlightedCommentId: null,
    comments: {},
    threads: {},
    commentMarksInitialized: false,
    highlightedCommentThreads: [],
  });

  return {
    params,
    editor: {
      md,
      setMd,
      error,
      setError,
      findAndReplace,
      setFindAndReplace,
    },
    rewrite: {
      rewriting,
      setRewriting,
      revisions,
      setRevisions,
    },
    generation: {
      isGenerating,
      setIsGenerating,
      generatedAndWaiting,
      setGeneratedAndWaiting,
      completion,
      setCompletion,
      generateMenuOpen,
      setGenerateMenuOpen,
      generateContext,
      setGenerateContext,
    },
    comments,
    setCommentState,
  };
}

export type MarkdownDocumentState = ReturnType<
  typeof createMarkdownDocumentState
>;
