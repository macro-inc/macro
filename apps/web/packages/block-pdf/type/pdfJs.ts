// PDF.js decided to not annotate the types for annotations, so here we are

type Direction = 'ltr' | 'rtl';
export type Rect = [number, number, number, number];
interface Coord {
  x: number;
  y: number;
}
export type QuadCoord = [Coord, Coord, Coord, Coord];
interface PDFString {
  str: string;
  dir: Direction;
}

// Copied from pdf.js#dist/lib/shared/util.js for convenience
export const AnnotationType = {
  TEXT: 1,
  LINK: 2,
  FREETEXT: 3,
  LINE: 4,
  SQUARE: 5,
  CIRCLE: 6,
  POLYGON: 7,
  POLYLINE: 8,
  HIGHLIGHT: 9,
  UNDERLINE: 10,
  SQUIGGLY: 11,
  STRIKEOUT: 12,
  STAMP: 13,
  CARET: 14,
  INK: 15,
  POPUP: 16,
  FILEATTACHMENT: 17,
  SOUND: 18,
  MOVIE: 19,
  WIDGET: 20,
  SCREEN: 21,
  PRINTERMARK: 22,
  TRAPNET: 23,
  WATERMARK: 24,
  THREED: 25,
  REDACT: 26,
} as const;

/** see `AnnotationType` in pdfjs-dist/types/src/shared/util.d.ts */
export enum ShapeType {
  CIRCLE = 'circle',
  TRIANGLE = 'triangle',
  RECTANGLE = 'rectangle',
  SQUARE = 'square',
}

// Copied from pdf.js#dist/lib/shared/util.js for convenience
export const AnnotationFlag = {
  INVISIBLE: 0x01,
  HIDDEN: 0x02,
  PRINT: 0x04,
  NOZOOM: 0x08,
  NOROTATE: 0x10,
  NOVIEW: 0x20,
  READONLY: 0x40,
  LOCKED: 0x80,
  TOGGLENOVIEW: 0x100,
  LOCKEDCONTENTS: 0x200,
};

/**
 * A PDF.js annotation as data (not the Annotation class)
 * JS implementation [details](https://github.com/mozilla/pdfjs-dist/blob/7b877584ca3b23b47f0be0a83140e3c199853ec8/lib/core/annotation.js#L2476)
 */
export interface Annotation {
  annotationFlags: (typeof AnnotationFlag)[keyof typeof AnnotationFlag];
  borderStyle?: {
    width: number;
    style: number;
    dashArray: number[];
    horizontalCornerRadius: number;
    verticalCornerRadius: number;
  };
  /** [R, G, B] */
  color: Uint8ClampedArray | null;
  /** [R, G, B] */
  backgroundColor: Uint8ClampedArray | null;
  /** [R, G, B] */
  borderColor: Uint8ClampedArray | null;
  /** Usually the contents of a comment */
  contentsObj: PDFString | null;
  hasAppearance: boolean;
  id: string;
  modificationDate: string | null;
  rect: Rect;
  subtype: string;
  inReplyTo?: string;
  /** Usually the author of a comment */
  titleObj: PDFString | null;
  creationDate: string | null;
  annotationType: (typeof AnnotationType)[keyof typeof AnnotationType];
  quadPoints: QuadCoord[] | null;
  defaultAppearance: string | null;
  rawColor: [number, number, number] | null;
  rawInteriorColor: [number, number, number] | null;
}
