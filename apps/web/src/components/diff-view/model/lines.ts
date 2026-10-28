/**
 * Lines of a file's diff that a host picks, or hangs its own content under
 * (review notes, comments). The view places the content; the host decides
 * what it says.
 */

/** Which side of the diff a line belongs to, in Pierre's vocabulary. */
export type DiffSide = 'additions' | 'deletions';

/**
 * A run of lines in a file's diff. It ends on `side`, where content hangs. In
 * the unified view a range can start on the other side, dragged from deleted
 * lines into added ones, like GitHub's `start_side`.
 */
export type LineRange = {
  path: string;
  side: DiffSide;
  /** Set only when the first line is on the other side from the last. */
  startSide?: DiffSide;
  /** First line, in `startSide`'s numbering (or `side`'s when unset). */
  lineNumber: number;
  /** Last line, in `side`'s numbering; equal to `lineNumber` for one line. */
  endLineNumber: number;
};

/** A spot under one line where host content hangs. */
export type LineAnnotation = {
  /** Unique within the file; handed back to the host to render. */
  key: string;
  side: DiffSide;
  lineNumber: number;
};
