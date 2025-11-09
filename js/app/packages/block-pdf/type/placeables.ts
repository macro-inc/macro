import { toZodNumberSet } from '@core/util/zod';
import { z } from 'zod';
import { ColorSchema } from '../model/Color';
import type { ThreadPayload } from './comments';
import { ShapeType } from './pdfJs';

/**
 *  Concepts and types.
 *  @ISignature | @ITextBox | @IShape | @IImage | @IFreeComment | @IBookmark | @IPageNumber
 *
     ------------------------------------------------------------------
     BACKEND MUST SAVE THESE TO PDF
     ------------------------------------------------------------------
    - Digital signature: @ISignature
    - Add Text: @ITextBox + textType: "pdf-text"
    - Watermark: @IImage + @PageRange
    - Text Header or Footer: @ITextBox + @PageRange
    - Page number: @IPageNumber
        Frontend concept only. Gets translated into a series of @TextBox before being sent to the backend.
    - Redact: @IShape + "redact" = true
    - Image: @IImage
    ------------------------------------------------------------------
     BACKEND MUST SAVE THESE TO PDF *AND EXTRACT FROM SAVED FILES*
    ------------------------------------------------------------------
    - Shape: @IShape
    - Pen marking: [TODO later]
    - Text Comment: @ITextBox + textType: "annotation"
    - Free comment: @IFreeComment
    - Free comment thread: @Thread
 */

export type AllowableEdits = z.infer<typeof AllowableEditsSchema>;
const AllowableEditsSchema = z.union([
  z.literal('locked'),
  z.object({
    allowResize: z.boolean(),
    allowTranslate: z.boolean(),
    allowRotate: z.boolean(),
    allowDelete: z.boolean(),
    lockAspectRatio: z.boolean(),
  }),
]);

export type IPlaceablePosition = z.infer<typeof PlaceablePositionSchema>;
export const PlaceablePositionSchema = z.object({
  xPct: z.number(),
  yPct: z.number(),
  widthPct: z.number(),
  heightPct: z.number(),
  rotation: z.number(), // in degrees
});

export type PayloadType = (typeof PayloadMode)[keyof typeof PayloadMode];
export const PayloadMode = {
  TextBox: 'text-box',
  FreeTextAnnotation: 'free-text-annotation',
  Shape: 'shape',
  ShapeAnnotation: 'shape-annotation',
  Image: 'image',
  Bookmark: 'bookmark',
  FreeComment: 'free-comment',
  Thread: 'thread',
  PageNumber: 'page-number',
  Signature: 'signature',
  Watermark: 'watermark',
  HeaderFooter: 'header-footer',
  Redact: 'redact',
  NoMode: 'no-mode',
} as const;

export type IImage = z.infer<typeof IImageSchema>;
const IImageSchema = z.object({
  /**
   * Format of the string is:   data:image/png;base64,ACTUAL_DATA
   */
  base64: z.string().nullable(),
  opacity: z.number(),
  aspectRatio: z
    .number()
    .nullable()
    .optional()
    .transform((data) => data ?? null),
});

export type IBookmark = z.infer<typeof IBookmarkSchema>;
const IBookmarkSchema = z.object({
  id: z.string(),
});

export type ITextBox = z.infer<typeof ITextBoxSchema>;
const ITextBoxSchema = z.object({
  color: ColorSchema,
  fontSize: z.number(),
  fontFamily: z.string(),
  bold: z.boolean(),
  text: z.string(),
  italic: z.boolean(),
  underlined: z.boolean(),
  // can be saved as free text annotation, or as a "text comment" by backend
  textType: z.union([z.literal('annotation'), z.literal('pdf-text')]),
});

export type IPageNumber = z.infer<typeof IPageNumberSchema>;
const IPageNumberSchema = z
  .object({
    // transformed into @TextBox object before being sent to the backend
    prefix: z.string(),
    suffix: z.string(),
    digits: z.number(),
    startNum: z.number(),
    mapper: z.function().args(z.number()).returns(z.string()),
  })
  .and(ITextBoxSchema);

export type ISignature = z.infer<typeof ISignatureSchema>;
const ISignatureSchema = z
  .object({
    dateTime: z.number(), // ms since 1970
    location: z.string(), // signing location
    email: z.string(), // signing email
    signerCert: z.instanceof(Blob).nullable(), // pdf eSignature applied by backend if not null
    signatureType: z.literal('image'),
  })
  .and(IImageSchema);

export type IShape = z.infer<typeof IShapeSchema>;
const IShapeSchema = z.object({
  redact: z.boolean(), // [true] = redact everything behind the box [false] = regular box
  fillColor: ColorSchema,
  borderColor: ColorSchema,
  borderWidth: z.number().optional(),
  color: ColorSchema,
  shape: z.nativeEnum(ShapeType),
});

export type IThreadPlaceable = Extract<
  IPlaceable,
  { payloadType: 'thread' }
> & { owner: string; isNew: boolean };
export type ITextBoxPlaceable = Extract<
  IPlaceable,
  { payloadType: 'free-text-annotation' }
>;
export type ISignaturePlaceable = Extract<
  IPlaceable,
  { payloadType: 'signature' }
>;

export type IPlaceablePayload = z.infer<typeof IPayloadSchema>;
const IPayloadSchema = z.discriminatedUnion('payloadType', [
  z.object({
    payload: ITextBoxSchema,
    payloadType: z.literal('text-box'),
  }),
  z.object({
    payload: IShapeSchema,
    payloadType: z.literal('shape'),
  }),
  z.object({
    payload: ITextBoxSchema,
    payloadType: z.literal('free-text-annotation'),
  }),
  z.object({
    payload: IShapeSchema,
    payloadType: z.literal('shape-annotation'),
  }),
  z.object({
    payload: IImageSchema,
    payloadType: z.literal('image'),
  }),
  z.object({
    payload: IBookmarkSchema,
    payloadType: z.literal('bookmark'),
  }),
  // NOTE: this is here temporarily to make the thread placeable type work properly
  z.object({
    payload: z.any().transform((x) => x as ThreadPayload | null),
    payloadType: z.literal('thread'),
  }),
  z.object({
    payload: IPageNumberSchema,
    payloadType: z.literal('page-number'),
  }),
  z.object({
    payload: ISignatureSchema,
    payloadType: z.literal('signature'),
  }),
]);

const PlaceableBaseSchema = z.object({
  allowableEdits: AllowableEditsSchema,
  wasEdited: z.boolean(),
  wasDeleted: z.boolean(),
  pageRange: toZodNumberSet,
  position: PlaceablePositionSchema,
  shouldLockOnSave: z.boolean(), // set allowableEdits.locked on ctrl+S
  originalPage: z.number(), // used for TextBox contenteditable focus
  originalIndex: z.number(), // original index in annotations or -1 for new
});
export type IPlaceable = z.infer<typeof IPlaceableSchema>;
export const IPlaceableSchema = PlaceableBaseSchema.and(IPayloadSchema).and(
  z.object({ internalId: z.string() })
);
export const IPlaceableServerSchema = PlaceableBaseSchema.and(IPayloadSchema);
