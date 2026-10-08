import { freezeDocument, type GraphicsDocument } from '@macro-inc/graphics';
import { validCanvasTextDocument } from './text-codec';

export const CANVAS_VERSION = 2;
export type CanvasFile = Readonly<{
  version: typeof CANVAS_VERSION;
  document: GraphicsDocument;
  /** Original input is retained for recovery; it is never replayed over edits. */
  legacy?: Readonly<{
    version: 1;
    source: Record<string, unknown>;
    notes: readonly string[];
  }>;
}>;
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function canvasVersion(value: unknown): 1 | 2 {
  if (!isRecord(value)) throw new Error('Invalid canvas file');
  if (value.version === undefined || value.version === 1) {
    if (
      !['nodes', 'edges', 'groups'].some((key) => key in value) &&
      Object.keys(value).some((key) => key !== 'version')
    )
      throw new Error('Unrecognized canvas format');
    return 1;
  }
  if (value.version === CANVAS_VERSION) return CANVAS_VERSION;
  throw new Error(
    `Unsupported canvas version: ${String(value.version)}. Update the app to open this canvas.`
  );
}

export function readCanvasFile(value: unknown): CanvasFile {
  if (canvasVersion(value) !== CANVAS_VERSION || !isRecord(value))
    throw new Error('Canvas needs migration');
  const document = freezeDocument(value.document as GraphicsDocument);
  if (!validCanvasTextDocument(document))
    throw new Error('Invalid canvas text');
  if (
    value.legacy !== undefined &&
    (!isRecord(value.legacy) ||
      value.legacy.version !== 1 ||
      !isRecord(value.legacy.source) ||
      !Array.isArray(value.legacy.notes) ||
      !value.legacy.notes.every((note) => typeof note === 'string'))
  )
    throw new Error('Invalid canvas migration metadata');
  // Retain same-version extension fields rather than stripping them on save.
  return { ...value, version: CANVAS_VERSION, document } as CanvasFile;
}
