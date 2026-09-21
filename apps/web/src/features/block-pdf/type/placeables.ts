import type {
  PdfPlaceable,
  PdfThreadPlaceable,
} from '@coparse/document-processing-types';
import type { ThreadPayload } from './comments';

export type {
  PdfAllowableEdits as AllowableEdits,
  PdfImage as IImage,
  PdfPageNumber as IPageNumber,
  PdfPayloadType as PayloadType,
  PdfPlaceableBookmark as IBookmark,
  PdfPlaceablePayload as IPlaceablePayload,
  PdfPlaceablePosition as IPlaceablePosition,
  PdfShape as IShape,
  PdfSignature as ISignature,
  PdfSignaturePlaceable as ISignaturePlaceable,
  PdfTextBox as ITextBox,
  PdfTextBoxPlaceable as ITextBoxPlaceable,
} from '@coparse/document-processing-types';
export {
  PdfPayloadMode as PayloadMode,
  PdfPlaceablePositionSchema as PlaceablePositionSchema,
  PdfPlaceableSchema as IPlaceableSchema,
  PdfPlaceableServerSchema as IPlaceableServerSchema,
} from '@coparse/document-processing-types';

/** A comment placeable whose discussion is a shared message thread. */
export type IThreadPlaceable = Omit<PdfThreadPlaceable, 'payload'> & {
  payload: ThreadPayload | null;
};

/** Placeables saved in the modification data, plus the comment placeables the anchors own. */
export type IPlaceable =
  | Exclude<PdfPlaceable, { payloadType: 'thread' }>
  | IThreadPlaceable;

export type IModificationPlaceable = Exclude<IPlaceable, IThreadPlaceable>;

export function isThreadPlaceable(
  placeable: IPlaceable
): placeable is IThreadPlaceable {
  return placeable.payloadType === 'thread';
}

/** Placeables persisted with the document; comment placeables live on the annotations. */
export function isModificationPlaceable(
  placeable: IPlaceable
): placeable is IModificationPlaceable {
  return !isThreadPlaceable(placeable);
}
