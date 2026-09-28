/**
 * Lines of a file's diff that a host picks, or hangs its own content under
 * (review notes, comments). The view places the content; the host decides
 * what it says.
 */

/** Which side of the diff a line belongs to, in Pierre's vocabulary. */
export type DiffSide = 'additions' | 'deletions';

/** A run of lines on one side of a file's diff. */
export type LineRange = {
  path: string;
  side: DiffSide;
  /** First line of the range, in that side's numbering. */
  lineNumber: number;
  /** Last line, equal to `lineNumber` for a single line. */
  endLineNumber: number;
};

/** A spot under one line where host content hangs. */
export type LineAnnotation = {
  /** Unique within the file; handed back to the host to render. */
  key: string;
  side: DiffSide;
  lineNumber: number;
};
