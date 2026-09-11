import type { MarkdownEditorErrors } from '@core/component/LexicalMarkdown/constants';
import type {
  Completion,
  GenerateMenuOpen,
} from '@core/component/LexicalMarkdown/plugins';
import type { CommentThread } from '@service-storage/generated/schemas/commentThread';
import { createResource, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import type {
  CommentStore,
  MarkStore,
  ThreadStore,
} from '../comments/commentType';
import { fetchMarkdownComments } from '../queries/markdown-comments';
import {
  type FindAndReplaceState,
  initialFindAndReplaceState,
} from '../signal/findAndReplaceStore';
import type { MdData } from '../signal/markdownBlockData';
import type { Diff } from '../signal/rewriteSignal';

export function createMarkdownDocumentState(documentId: string) {
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

  const [marks, setMarks] = createStore<MarkStore>({});
  const [activeMarkIds, setActiveMarkIds] = createSignal<string[]>([]);
  const [activeCommentThread, setActiveCommentThread] = createSignal<
    number | null
  >(null);
  const [highlightedCommentId, setHighlightedCommentId] = createSignal<
    number | null
  >(null);
  const [comments, setComments] = createStore<CommentStore>({});
  const [threads, setThreads] = createStore<ThreadStore>({});
  const [commentMarksInitialized, setCommentMarksInitialized] =
    createSignal(false);
  const [highlightedCommentThreads, setHighlightedCommentThreads] =
    createSignal<number[]>([]);
  const [wideEnoughForComments, setWideEnoughForComments] = createSignal(true);
  const [commentThreads, commentThreadActions] = createResource<
    CommentThread[],
    string
  >(() => (md.editor ? documentId : undefined), fetchMarkdownComments);

  return {
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
    comments: {
      marks,
      setMarks,
      activeMarkIds,
      setActiveMarkIds,
      activeCommentThread,
      setActiveCommentThread,
      highlightedCommentId,
      setHighlightedCommentId,
      comments,
      setComments,
      threads,
      setThreads,
      commentMarksInitialized,
      setCommentMarksInitialized,
      highlightedCommentThreads,
      setHighlightedCommentThreads,
      wideEnoughForComments,
      setWideEnoughForComments,
      commentThreads,
      commentThreadActions,
    },
  };
}

export type MarkdownDocumentState = ReturnType<
  typeof createMarkdownDocumentState
>;
