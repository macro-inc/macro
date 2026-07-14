import type { IComment } from '@core/comments/commentType';
import { z } from 'zod';

const numberSetSchema = z
  .union([z.set(z.number()), z.array(z.number())])
  .transform((data) => (data instanceof Set ? data : new Set(data)));

export const PdfColorSchema = z.object({
  red: z.number(),
  green: z.number(),
  blue: z.number(),
  alpha: z.number().optional(),
});

export type PdfColor = z.infer<typeof PdfColorSchema>;

export enum PdfShapeType {
  CIRCLE = 'circle',
  TRIANGLE = 'triangle',
  RECTANGLE = 'rectangle',
  SQUARE = 'square',
}

export type PdfThreadPayload = {
  threadId: number;
  rootId: number;
  anchorId: string;
  page: number;
  comments: IComment[];
  isResolved: boolean;
};

export const PdfAllowableEditsSchema = z.union([
  z.literal('locked'),
  z.object({
    allowResize: z.boolean(),
    allowTranslate: z.boolean(),
    allowRotate: z.boolean(),
    allowDelete: z.boolean(),
    lockAspectRatio: z.boolean(),
  }),
]);

export type PdfAllowableEdits = z.infer<typeof PdfAllowableEditsSchema>;

export const PdfPlaceablePositionSchema = z.object({
  xPct: z.number(),
  yPct: z.number(),
  widthPct: z.number(),
  heightPct: z.number(),
  rotation: z.number(),
});

export type PdfPlaceablePosition = z.infer<typeof PdfPlaceablePositionSchema>;

export const PdfPayloadMode = {
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

export type PdfPayloadType =
  (typeof PdfPayloadMode)[keyof typeof PdfPayloadMode];

const PdfImageSchema = z.object({
  base64: z.string().nullable(),
  opacity: z.number(),
  aspectRatio: z
    .number()
    .nullable()
    .optional()
    .transform((data) => data ?? null),
});

export type PdfImage = z.infer<typeof PdfImageSchema>;

const PdfPlaceableBookmarkSchema = z.object({
  id: z.string(),
});

export type PdfPlaceableBookmark = z.infer<typeof PdfPlaceableBookmarkSchema>;

const PdfTextBoxSchema = z.object({
  color: PdfColorSchema,
  fontSize: z.number(),
  fontFamily: z.string(),
  bold: z.boolean(),
  text: z.string(),
  italic: z.boolean(),
  underlined: z.boolean(),
  textType: z.union([z.literal('annotation'), z.literal('pdf-text')]),
});

export type PdfTextBox = z.infer<typeof PdfTextBoxSchema>;

const PdfPageNumberSchema = z
  .object({
    prefix: z.string(),
    suffix: z.string(),
    digits: z.number(),
    startNum: z.number(),
    mapper: z.function({ input: [z.number()], output: z.string() }),
  })
  .and(PdfTextBoxSchema);

export type PdfPageNumber = z.infer<typeof PdfPageNumberSchema>;

const PdfSignatureSchema = z
  .object({
    dateTime: z.number(),
    location: z.string(),
    email: z.string(),
    signerCert: z.instanceof(Blob).nullable(),
    signatureType: z.literal('image'),
  })
  .and(PdfImageSchema);

export type PdfSignature = z.infer<typeof PdfSignatureSchema>;

const PdfShapeSchema = z.object({
  redact: z.boolean(),
  fillColor: PdfColorSchema,
  borderColor: PdfColorSchema,
  borderWidth: z.number().optional(),
  color: PdfColorSchema,
  shape: z.nativeEnum(PdfShapeType),
});

export type PdfShape = z.infer<typeof PdfShapeSchema>;

const PdfPlaceablePayloadSchema = z.discriminatedUnion('payloadType', [
  z.object({
    payload: PdfTextBoxSchema,
    payloadType: z.literal('text-box'),
  }),
  z.object({
    payload: PdfShapeSchema,
    payloadType: z.literal('shape'),
  }),
  z.object({
    payload: PdfTextBoxSchema,
    payloadType: z.literal('free-text-annotation'),
  }),
  z.object({
    payload: PdfShapeSchema,
    payloadType: z.literal('shape-annotation'),
  }),
  z.object({
    payload: PdfImageSchema,
    payloadType: z.literal('image'),
  }),
  z.object({
    payload: PdfPlaceableBookmarkSchema,
    payloadType: z.literal('bookmark'),
  }),
  z.object({
    payload: z.any().transform((value) => value as PdfThreadPayload | null),
    payloadType: z.literal('thread'),
  }),
  z.object({
    payload: PdfPageNumberSchema,
    payloadType: z.literal('page-number'),
  }),
  z.object({
    payload: PdfSignatureSchema,
    payloadType: z.literal('signature'),
  }),
]);

export type PdfPlaceablePayload = z.infer<typeof PdfPlaceablePayloadSchema>;

const PdfPlaceableBaseSchema = z.object({
  allowableEdits: PdfAllowableEditsSchema,
  wasEdited: z.boolean(),
  wasDeleted: z.boolean(),
  pageRange: numberSetSchema,
  position: PdfPlaceablePositionSchema,
  shouldLockOnSave: z.boolean(),
  originalPage: z.number(),
  originalIndex: z.number(),
});

export const PdfPlaceableSchema = PdfPlaceableBaseSchema.and(
  PdfPlaceablePayloadSchema
).and(z.object({ internalId: z.string() }));

export const PdfPlaceableServerSchema = PdfPlaceableBaseSchema.and(
  PdfPlaceablePayloadSchema
);

export type PdfPlaceable = z.infer<typeof PdfPlaceableSchema>;
export type PdfThreadPlaceable = Extract<
  PdfPlaceable,
  { payloadType: 'thread' }
> & { owner: string; isNew: boolean };
export type PdfTextBoxPlaceable = Extract<
  PdfPlaceable,
  { payloadType: 'free-text-annotation' }
>;
export type PdfSignaturePlaceable = Extract<
  PdfPlaceable,
  { payloadType: 'signature' }
>;

export function isPdfThreadPlaceable(
  placeable: PdfPlaceable
): placeable is PdfThreadPlaceable {
  return placeable.payloadType === 'thread';
}

export interface PdfOutlineBookmark {
  title: string | null;
  pageNum: number;
  top: number;
  children: PdfOutlineBookmark[];
  id: number;
}

export const PdfOutlineBookmarkSchema: z.ZodType<PdfOutlineBookmark> = z.object(
  {
    title: z.string().nullable(),
    pageNum: z.number(),
    top: z.number(),
    children: z.array(
      z.lazy(() => PdfOutlineBookmarkSchema as z.ZodType<PdfOutlineBookmark>)
    ),
    id: z.number(),
  }
);

const PdfTextTokenDataSchema = z.object({
  text: z.string(),
  y: z.number(),
});

export type PdfTextTokenData = z.infer<typeof PdfTextTokenDataSchema>;

const PdfTextBoxDataSchema = z.object({
  text: z.string(),
  y: z.number(),
  textTokenDatas: z.array(PdfTextTokenDataSchema),
});

export type PdfTextBoxData = z.infer<typeof PdfTextBoxDataSchema>;

const PdfPageDataSchema = z.object({
  pageNum: z.number(),
  pageHeight: z.number(),
  textBoxDatas: z.array(PdfTextBoxDataSchema),
});

export type PdfPageData = z.infer<typeof PdfPageDataSchema>;

export const PdfDocumentDataSchema = z.object({
  numPages: z.number(),
  pageDatas: z.array(PdfPageDataSchema),
});

export type PdfDocumentData = z.infer<typeof PdfDocumentDataSchema>;

export const PdfAnomalySchema = z.object({
  type: z.string(),
  page: z.number(),
  yPos: z.number(),
  xPos: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  message: z.string(),
});

export type PdfAnomaly = z.infer<typeof PdfAnomalySchema>;

export const PdfSegmentSchema = z.object({
  text: z.string(),
  pageNum: z.number(),
  y: z.number(),
  height: z.number(),
});

export type PdfSegment = z.infer<typeof PdfSegmentSchema>;

export const PdfModificationDataOnServerSchema = z.object({
  highlights: z.any(),
  bookmarks: z
    .array(PdfOutlineBookmarkSchema)
    .nullish()
    .transform((data) => data ?? []),
  placeables: z
    .array(PdfPlaceableServerSchema)
    .nullish()
    .transform((data) => data ?? []),
  pinnedTermsNames: z
    .array(z.string())
    .nullish()
    .transform((data) => data ?? []),
});

export type PdfModificationDataOnServer = z.infer<
  typeof PdfModificationDataOnServerSchema
>;

export interface PdfCoParse {
  bookmarks?: PdfOutlineBookmark[];
  hash?: string;
  toc?: string;
  annotations?: {
    textAnnotations: Array<{
      pageNum: number;
    }>;
  };
  defs?: string;
  overlays: string[];
  anomalies?: PdfAnomaly[];
  pinnedTermsNames?: string[];
  documentData?: PdfDocumentData;
}

export const PdfCoParseSchema: z.ZodType<PdfCoParse, any> = z.object({
  bookmarks: z.array(PdfOutlineBookmarkSchema).optional(),
  hash: z.string().optional(),
  toc: z.string().optional(),
  annotations: z
    .object({
      textAnnotations: z.array(
        z.object({
          pageNum: z.number(),
        })
      ),
    })
    .optional(),
  defs: z.string().optional(),
  overlays: z.array(z.string()),
  anomalies: z.array(PdfAnomalySchema).optional(),
  pinnedTermsNames: z.preprocess(
    () => undefined,
    z.array(z.string()).optional()
  ),
  documentData: PdfDocumentDataSchema.optional(),
});

export const isEmptyPdfCoParse = (coparse: PdfCoParse): boolean => {
  return !coparse.defs;
};

export const modificationDataReplacer = (key: string, value: any) => {
  if (key === 'pageRange') {
    return Array.from(value);
  }

  if (typeof value === 'number' && !Number.isInteger(value)) {
    return parseFloat(value.toFixed(12));
  }

  return value;
};
