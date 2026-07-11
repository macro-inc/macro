import { createBlockSignal, createBlockStore } from '@core/block';
import type { NodeKey } from 'lexical';
import type { CommentStore, MarkStore, ThreadStore } from './commentType';

interface PendingComment {
  anchorKey: NodeKey;
  anchorOffset: number;
  focusKey: NodeKey;
  focusOffset: number;
}

export const markStore = createBlockStore<MarkStore>({});

export const activeMarkIdsSignal = createBlockSignal<string[]>([]);

export const activeCommentThreadSignal = createBlockSignal<number | null>(null);
export const highlightedCommentIdSignal = createBlockSignal<number | null>(
  null
);

export const commentsStore = createBlockStore<CommentStore>({});

export const threadStore = createBlockStore<ThreadStore>({});

export const commentMarksInitializedSignal = createBlockSignal<boolean>(false);

export const highlightedCommentThreadsSignal = createBlockSignal<number[]>([]);

export const pendingCommentSignal = createBlockSignal<PendingComment[]>([]);

export const commentWidthSignal = createBlockSignal(true);
