import { isThreadPlaceable } from '@block-pdf/store/comments/freeComments';
import { ENABLE_PINS } from '@core/constant/featureFlags';
import { v7 as uuid7 } from 'uuid';
import { z } from 'zod';
import {
  type IPlaceable,
  IPlaceableSchema,
  IPlaceableServerSchema,
} from '../type/placeables';
import { type IBookmark, IBookmarkSchema } from './Bookmark';

export enum CoParseClassName {
  SectionReference = 'sref',
  TermReference = 'tref',
}

export enum ApplicationMode {
  Home = 'home',
  Viewer = 'viewer',
  Editor = 'editor',
}

export type TTextTokenData = z.infer<typeof TTextTokenDataSchema>;
const TTextTokenDataSchema = z.object({
  text: z.string(),
  y: z.number(),
});

export type TTextBoxData = z.infer<typeof TTextBoxDataSchema>;
const TTextBoxDataSchema = z.object({
  text: z.string(),
  y: z.number(),
  textTokenDatas: z.array(TTextTokenDataSchema),
});

export type TPageData = z.infer<typeof TPageDataSchema>;
const TPageDataSchema = z.object({
  pageNum: z.number(),
  pageHeight: z.number(),
  textBoxDatas: z.array(TTextBoxDataSchema),
});

export type TDocumentData = z.infer<typeof TDocumentDataSchema>;
export const TDocumentDataSchema = z.object({
  numPages: z.number(),
  pageDatas: z.array(TPageDataSchema),
});

export type TAnomaly = z.infer<typeof TAnomalySchema>;
export const TAnomalySchema = z.object({
  type: z.string(),
  page: z.number(),
  yPos: z.number(),
  xPos: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  message: z.string(),
});

export type TSegment = z.infer<typeof TSegmentSchema>;
export const TSegmentSchema = z.object({
  text: z.string(),
  pageNum: z.number(),
  y: z.number(),
  height: z.number(),
});

// @ts-ignore
// biome-ignore lint/correctness/noUnusedVariables: kept for reference
interface IOldModificationData {
  highlights: Partial<Record<number, Highlight[]>> | null;
  bookmarks: IBookmark[] | null;
  placeables: IPlaceable[] | null;
  pinnedTermsNames: string[] | null;
}

export type IModificationDataOnServer = z.infer<
  typeof IModificationDataOnServerSchema
>;
export const IModificationDataOnServerSchema = z.object({
  highlights: z.any(),
  bookmarks: z
    .array(IBookmarkSchema)
    .nullish()
    .transform((data) => data ?? []),
  placeables: z
    .array(IPlaceableServerSchema)
    .nullish()
    .transform((data) => data ?? []),
  pinnedTermsNames: z
    .array(z.string())
    .nullish()
    .transform((data) => data ?? []),
});

export interface IModificationData {
  bookmarks: IBookmark[];
  placeables: IPlaceable[];
  pinnedTermsNames: string[];
}

// NOTE: typing this way ensures that the parsed output matches the expected type
export const IModificationDataSchema: z.ZodType<
  IModificationData,
  z.ZodTypeDef,
  any
> = z.object({
  bookmarks: z.array(IBookmarkSchema),
  placeables: z.array(IPlaceableSchema),
  pinnedTermsNames: z.array(z.string()),
});

// Transform server data to client data
export function transformModificationDataToClient(
  data: IModificationDataOnServer
): IModificationData {
  return {
    bookmarks: data.bookmarks,
    placeables: data.placeables
      // using any because internal id is not stored on the server type
      // and I don't want to omit from the predicate fucntion or make a new one
      .filter((p) => !isThreadPlaceable(p as any))
      .map((p) => {
        return { ...p, internalId: uuid7() };
      }),
    pinnedTermsNames: data.pinnedTermsNames,
  };
}

// Transform client data to server data
export function transformModificationDataToServer(
  data: IModificationData
): IModificationDataOnServer {
  return {
    bookmarks: data.bookmarks,
    placeables: data.placeables
      .filter((p) => !isThreadPlaceable(p))
      .map((p) => {
        const { internalId: _, ...rest } = p;
        return rest;
      }),
    pinnedTermsNames: data.pinnedTermsNames,
  };
}

export type Font = {
  fontUrl: string;
  fontName: string;
};

export interface ICoParse {
  bookmarks?: IBookmark[];
  hash?: string;
  /**
   * Stringified XML of the PDF table of contents
   */
  toc?: string;
  annotations?: {
    // TODO type here
    textAnnotations: Array<{
      pageNum: number;
    }>;
  };
  defs?: string;
  overlays: string[];
  anomalies?: Array<TAnomaly>;
  pinnedTermsNames?: Array<string>;
  documentData?: TDocumentData;
}

export const CoParseSchema: z.ZodType<ICoParse, z.ZodTypeDef, any> = z.object({
  bookmarks: z.array(IBookmarkSchema).optional(),
  hash: z.string().optional(),
  toc: z.string().optional(), // Stringified XML of the PDF table of contents
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
  anomalies: z.array(TAnomalySchema).optional(),
  pinnedTermsNames: z.preprocess((data) => {
    if (!ENABLE_PINS) return undefined;

    // TODO: remove this when the API is fixed
    if (data === '[]' || data === '') {
      return [];
    }

    if (typeof data === 'string') {
      return JSON.parse(data);
    }

    return data;
  }, z.array(z.string()).optional()),
  documentData: TDocumentDataSchema.optional(),
});

/**
 * Indicates whether a coparse object has meaningful data.
 * If not we will run preprocess again in the load file pipeline.
 * Using the defs alone is a good indicator because a preprocess response will always have defs.
 * In the case of an empty document it will be an empty xml.
 */
export const isEmptyCoParse = (coparse: ICoParse): boolean => {
  return !coparse.defs;
};
