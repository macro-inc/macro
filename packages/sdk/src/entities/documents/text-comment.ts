import type { CommentOnTextRefused } from '../../../generated/storage/types.gen';
import { type RichMessage, toBody } from '../../mentions';
import type { MacroClient } from '../../utils/client';
import { MacroApiError, unwrap } from '../../utils/unwrap';
import { Comment } from './comment';
import type { Document } from './document';

/** Where `Document.commentOnText` anchors its comment. */
export interface TextCommentOptions {
  /**
   * The passage to comment on, quoted exactly as the document reads: plain
   * text without markdown syntax such as `**` or link brackets, within one
   * paragraph, heading, list item or table cell. Keep it to the words the
   * comment is about; a longer quote is more likely to be unique.
   */
  quote: string;

  /**
   * Which appearance of the quote, counting from 1 in document order. Only
   * needed when it appears more than once; a Word document takes only the
   * first.
   */
  occurrence?: number;
}

/** A comment anchored to text, and the text it is anchored to. */
export interface TextComment {
  /** The posted comment, the root of a new thread. */
  comment: Comment;
  /** The text the comment is anchored to, as the document reads. */
  markedText: string;
}

/**
 * The quote appears more than once, or not at all (HTTP 422). Nothing was
 * posted. `reason` lists each appearance to choose from with `occurrence`, or
 * says the text was not found: read the document again rather than guessing.
 */
export class CommentQuoteNotPlacedError extends MacroApiError {
  /** Why the quote could not be anchored, in the document's words. */
  readonly reason: string;

  constructor(refusal: CommentOnTextRefused) {
    super(422, refusal);
    this.name = 'CommentQuoteNotPlacedError';
    this.reason = refusal.reason;
    this.message = refusal.reason;
  }
}

/** Post a comment on quoted text; `Document.commentOnText` calls this. */
export async function commentOnText(
  client: MacroClient,
  document: Document,
  body: string | RichMessage,
  options: TextCommentOptions,
): Promise<TextComment> {
  const { content, mentions } = toBody(body);
  const result = await client.storage.commentOnDocumentText({
    path: { document_id: document.id },
    body: {
      content,
      mentions,
      quote: options.quote,
      occurrence: options.occurrence ?? null,
    },
  });
  if (isRefusal(result.error))
    throw new CommentQuoteNotPlacedError(result.error);
  const { comment, markedText } = unwrap(result);
  return {
    comment: Comment.from(client, document.id, comment),
    markedText,
  };
}

function isRefusal(error: unknown): error is CommentOnTextRefused {
  return (
    typeof error === 'object' &&
    error !== null &&
    'error' in error &&
    error.error === 'quote_not_placed' &&
    'reason' in error &&
    typeof error.reason === 'string'
  );
}
