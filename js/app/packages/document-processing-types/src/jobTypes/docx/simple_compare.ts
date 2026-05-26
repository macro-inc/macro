import { z } from 'zod';
import { BaseResponse } from '../baseResponse';
import {
  DocxBomPartSchema,
  DocxDocumentMetadataSchema,
} from '../documentMetadata';
import { ComparisionUpload } from './index';

const SimpleCompare = z.object({
  sourceUpload: ComparisionUpload,
  revisedUpload: ComparisionUpload,
  keepComments: z.boolean(),
  isPdfCompare: z.boolean(),
});

export function simple_compare_validate(data: { [name: string]: unknown }) {
  return SimpleCompare.parse(data);
}

/**
 * Compares the provided source upload against the revised upload. It also
 * saves the resulting docx document to the users macro cloud via DSS.
 * @returns the compared documents documentMetadata as well as the revision
 * count.
 */
export type SimpleCompare = z.infer<typeof SimpleCompare>;

const SimpleCompareResponseDataUploadCompleteSchema = z.object({
  documentMetadata: DocxDocumentMetadataSchema,
  insertions: z.number(),
  deletions: z.number(),
});

const SimpleCompareResponseDataUploadUnzippedSchema = z.object({
  bomParts: z.array(DocxBomPartSchema),
});

export type SimpleCompareResponseDataUploadComplete = z.infer<
  typeof SimpleCompareResponseDataUploadCompleteSchema
>;
export type SimpleCompareResponseDataUploadUnzipped = z.infer<
  typeof SimpleCompareResponseDataUploadUnzippedSchema
>;

const SimpleCompareResponseData = z.union([
  SimpleCompareResponseDataUploadCompleteSchema,
  SimpleCompareResponseDataUploadUnzippedSchema,
]);

export function simple_compare_upload_response(
  data: unknown
): data is SimpleCompareResponseDataUploadComplete {
  return SimpleCompareResponseDataUploadCompleteSchema.safeParse(data).success;
}

export function simple_compare_unzip_response(
  data: unknown
): data is SimpleCompareResponseDataUploadUnzipped {
  return SimpleCompareResponseDataUploadUnzippedSchema.safeParse(data).success;
}

function _simple_compare_response_data_validate(
  data: unknown
): data is SimpleCompareResponseData {
  return SimpleCompareResponseData.safeParse(data).success;
}

export type SimpleCompareResponseData = z.infer<
  typeof SimpleCompareResponseData
>;

const SimpleCompareResponse = BaseResponse.extend({
  data: SimpleCompareResponseData.optional(),
});

export function simple_compare_response_validate(data: {
  [name: string]: unknown;
}) {
  return SimpleCompareResponse.parse(data);
}

export type SimpleCompareResponse = z.infer<typeof SimpleCompareResponse>;
