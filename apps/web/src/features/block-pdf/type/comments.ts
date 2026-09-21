import type {
  CommentId,
  Reply,
  Root,
  ThreadId,
} from '@core/comments/commentType';
import type { Message } from '@service-storage/messages';

/** A discussion attached to a PDF anchor: its root message and the loaded reply preview. */
export type ThreadPayload = {
  threadId: ThreadId;
  rootId: CommentId;
  anchorId: string; // uuid
  page: number;
  comments: Message[];
  /** Total live replies; comments holds only the loaded preview. */
  replyCount: number;
  isResolved: boolean;
};

export type ViewerCommentType = 'free' | 'highlight';

export type Overflow = null | 'top' | 'bottom';
type Layout = { calculatedYPos: number; overflow: Overflow; height: number };

// represents a comment layout after it has been positioned
export type CommentLayout<T> = T & { layout: Layout };
type CommentViewerLayoutInfo = {
  pageIndex: number;
  originalYPosition: number;
};
// represents an initial comment layout in the viewer
export type CommentViewerInitialLayout<T> = T & {
  layout: CommentViewerLayoutInfo;
};

export type PdfRoot = Root & { type: ViewerCommentType };
export type PdfReply = Reply & { type: ViewerCommentType };
export type PdfRootLayout = CommentViewerInitialLayout<PdfRoot>;

export type PdfComment = PdfRootLayout | PdfReply;

export type CommentStore = PdfComment[];
