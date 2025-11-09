import type {
  CommentId,
  IComment,
  Reply,
  Root,
  ThreadId,
} from '@core/collab/comments/commentType';
import type { NodeKey } from 'lexical';

export type MarkId = string; // uuid

export type ThreadPayload = {
  threadId: number;
  rootId: number;
  anchorId: string; // uuid
  comments: IComment[];
  isResolved: boolean;
};

export type ThreadMetadata = {
  markId: MarkId;
};

type MarkNodeStore = Partial<Record<NodeKey, HTMLElement>>;
export type Mark = {
  id: MarkId;
  markNodes: MarkNodeStore;
  existsOnServer: boolean;
  owner: string;
  isDraft: boolean;
  peerId?: string;
  thread?: ThreadPayload;
};
export type MarkStore = Partial<Record<MarkId, Mark>>;

export type CommentStore = Partial<Record<CommentId, Root | Reply>>;
export type ThreadStore = Partial<Record<ThreadId, Root>>;
export type ThreadHeights = Partial<Record<ThreadId, number>>;
export type ThreadPositions = Partial<Record<MarkId, CommentLayout<{}>>>;

export type Overflow = null | 'top' | 'bottom';
export type Layout = {
  calculatedYPos: number;
  overflow: Overflow;
  height: number;
};

// represents a comment layout after it has been positioned
export type CommentLayout<T> = T & { layout: Layout };
export type CommentViewerLayoutInfo = {
  originalYPosition: number;
};
// represents an initial comment layout in the viewer
export type CommentViewerInitialLayout<T> = T & {
  layout: CommentViewerLayoutInfo;
};
