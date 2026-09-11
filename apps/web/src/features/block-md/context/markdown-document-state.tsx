import type { MarkdownEditorErrors } from '@core/component/LexicalMarkdown/constants';
import type {
  Completion,
  GenerateMenuOpen,
} from '@core/component/LexicalMarkdown/plugins';
import { createParamsState } from '@core/component/ParamsProvider';
import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import type {
  CommentStore,
  MarkStore,
  ThreadStore,
} from '../comments/commentType';
import {
  type FindAndReplaceState,
  initialFindAndReplaceState,
} from '../signal/findAndReplaceStore';
import type { MdData } from '../signal/markdownBlockData';
import type { Diff } from '../signal/rewriteSignal';

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
