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

export function simple_compare_validate(data: { [name: string]: any }) {
  const result = SimpleCompare.safeParse(data);
  if (result.success) {
    return result.data;
  }
  throw result.error;
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

const SimpleCompareResponseData =
  SimpleCompareResponseDataUploadCompleteSchema.or(
    SimpleCompareResponseDataUploadUnzippedSchema
  );

export function simple_compare_upload_response(
  data: any
): data is SimpleCompareResponseDataUploadComplete {
  const result = SimpleCompareResponseDataUploadCompleteSchema.safeParse(data);
  if (result.success) {
    return true;
  }
  return false;
}

export function simple_compare_unzip_response(
  data: any
): data is SimpleCompareResponseDataUploadUnzipped {
  const result = SimpleCompareResponseDataUploadUnzippedSchema.safeParse(data);
  if (result.success) {
    return true;
  }
  return false;
}

export function simple_compare_response_data_validate(
  data: any
): data is SimpleCompareResponseData {
  const result = SimpleCompareResponseData.safeParse(data);
  if (result.success) {
    return true;
  }
  return false;
}

export type SimpleCompareResponseData = z.infer<
  typeof SimpleCompareResponseData
>;

const SimpleCompareResponse = BaseResponse.extend({
  data: SimpleCompareResponseData.optional(),
});

export function simple_compare_response_validate(data: {
  [name: string]: any;
}) {
  const result = SimpleCompareResponse.safeParse(data);
  if (result.success) {
    return result.data;
  }
  throw result.error;
}

export type SimpleCompareResponse = z.infer<typeof SimpleCompareResponse>;
