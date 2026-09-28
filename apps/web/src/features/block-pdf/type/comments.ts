import type {
  CommentId,
  Reply,
  Root,
  ThreadId,
} from '@core/comments/commentType';
import type { Comment } from '@service-storage/generated/schemas/comment';
import type { Message } from '@service-storage/messages';

/**
 * The discussion on a PDF anchor: legacy annotation comments, or a message
 * root with its loaded reply preview when the document is on the message API.
 */
export type ThreadPayload = {
  threadId: ThreadId;
  rootId: CommentId;
  anchorId: string; // uuid
  page: number;
  comments: Comment[] | Message[];
  /** Total live replies of a message thread; comments holds only the loaded preview. */
  replyCount?: number;
  isResolved: boolean;
};

export type ViewerCommentType = 'free' | 'highlight';

const PDF_DRAFT_THREAD_PREFIX = 'pdf-draft:';

export type PdfDraftThreadId =
  `${typeof PDF_DRAFT_THREAD_PREFIX}${ViewerCommentType}:${string}`;

export function createPdfDraftThreadId(
  type: ViewerCommentType,
  anchorId: string
): PdfDraftThreadId {
  return `${PDF_DRAFT_THREAD_PREFIX}${type}:${anchorId}`;
}

export function isPdfDraftThreadId(
  id: CommentId | ThreadId | null | undefined
): id is PdfDraftThreadId {
  return typeof id === 'string' && id.startsWith(PDF_DRAFT_THREAD_PREFIX);
}

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
