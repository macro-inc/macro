import type {
  CreatedItem,
  EditOp,
  WordDocumentOperation,
} from '../../../generated/storage/types.gen';
import type { Document } from './document';

/**
 * One PowerPoint edit operation, discriminated by `op` (`setText`,
 * `formatText`, `addShape`, `addSlide`, `setChartData`, `replaceText`, ...).
 * Slides and shapes are addressed by the ids `readPresentation()` reports,
 * positions and sizes are in points, and colors are RRGGBB hex or theme names.
 */
export type PresentationEditOperation = EditOp;

/**
 * One Word edit operation, discriminated by `type` (`replaceText`, `setText`,
 * `formatText`, `insertParagraph`, `delete`, `setStyle`, `addComment`).
 * Paragraphs and blocks are addressed by the ids `readWord()` reports.
 */
export type WordEditOperation = WordDocumentOperation;

/** A slide, shape or section a presentation edit created. */
export type PresentationCreatedItem = CreatedItem;

/** What a presentation edit did. */
export interface PresentationEditResult {
  /** Slides and shapes the operations created, in order. */
  created: PresentationCreatedItem[];
  /**
   * Whether slides were added, removed or reordered, or the slide size or
   * sections changed.
   */
  structureChanged: boolean;
  /** The changed slides as they now read. */
  changedSlides: string;
}

/** An edited copy of a presentation, created as a new document. */
export interface PresentationCopy extends PresentationEditResult {
  /** The new presentation. */
  document: Document;
}

/** Options for `Document.editWord`. */
export interface WordEditOptions {
  /**
   * Record the edits as tracked changes (`true`) or apply them directly
   * (`false`). Omit to follow the document's own Track Changes setting.
   */
  trackChanges?: boolean;
  /**
   * Name the tracked changes and comments are attributed to. Omit to use the
   * requesting user's name; pass one only when the user names someone else.
   */
  author?: string;
}
