import {
  PdfCoParseSchema as CoParseSchema,
  type PdfCoParse as ICoParse,
  type PdfModificationDataOnServer as IModificationDataOnServer,
  PdfModificationDataOnServerSchema as IModificationDataOnServerSchema,
  isEmptyPdfCoParse as isEmptyCoParse,
  type PdfAnomaly as TAnomaly,
  PdfAnomalySchema as TAnomalySchema,
  type PdfDocumentData as TDocumentData,
  PdfDocumentDataSchema as TDocumentDataSchema,
  type PdfPageData as TPageData,
  type PdfSegment as TSegment,
  PdfSegmentSchema as TSegmentSchema,
  type PdfTextBoxData as TTextBoxData,
  type PdfTextTokenData as TTextTokenData,
} from '@coparse/document-processing-types';
import { v7 as uuid7 } from 'uuid';
import { z } from 'zod';
import { type IBookmark, IBookmarkSchema } from './Bookmark';
import {
  type IPlaceable,
  IPlaceableSchema,
  isThreadPlaceable,
} from './placeables';

export type {
  ICoParse,
  IModificationDataOnServer,
  TAnomaly,
  TDocumentData,
  TPageData,
  TSegment,
  TTextBoxData,
  TTextTokenData,
};
export {
  CoParseSchema,
  IModificationDataOnServerSchema,
  isEmptyCoParse,
  TAnomalySchema,
  TDocumentDataSchema,
  TSegmentSchema,
};

export enum CoParseClassName {
  SectionReference = 'sref',
  TermReference = 'tref',
}

export enum ApplicationMode {
  Home = 'home',
  Viewer = 'viewer',
  Editor = 'editor',
}

export interface IModificationData {
  bookmarks: IBookmark[];
  placeables: IPlaceable[];
  pinnedTermsNames: string[];
}

export const IModificationDataSchema: z.ZodType<IModificationData, any> =
  z.object({
    bookmarks: z.array(IBookmarkSchema),
    placeables: z.array(IPlaceableSchema),
    pinnedTermsNames: z.array(z.string()),
  });

export function transformModificationDataToClient(
  data: IModificationDataOnServer
): IModificationData {
  return {
    bookmarks: data.bookmarks,
    placeables: data.placeables
      .filter((placeable) => !isThreadPlaceable(placeable as any))
      .map((placeable) => ({ ...placeable, internalId: uuid7() })),
    pinnedTermsNames: data.pinnedTermsNames,
  };
}

export function transformModificationDataToServer(
  data: IModificationData
): IModificationDataOnServer {
  return {
    highlights: null,
    bookmarks: data.bookmarks,
    placeables: data.placeables
      .filter((placeable) => !isThreadPlaceable(placeable))
      .map((placeable) => {
        const { internalId: _, ...serverPlaceable } = placeable;
        return serverPlaceable;
      }),
    pinnedTermsNames: data.pinnedTermsNames,
  };
}

export type Font = {
  fontUrl: string;
  fontName: string;
};
