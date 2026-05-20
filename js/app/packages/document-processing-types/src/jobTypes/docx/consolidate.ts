import { z } from 'zod';
import { BaseResponse } from '../baseResponse';
import {
  DocxBomPartSchema,
  DocxDocumentMetadataSchema,
} from '../documentMetadata';
import { ComparisionUpload } from './index';

const Consolidate = z.object({
  sourceUpload: ComparisionUpload,
  revisedUploads: z.array(ComparisionUpload),
  isPdfCompare: z.boolean(),
});

export function consolidate_validate(data: { [name: string]: unknown }) {
  return Consolidate.parse(data);
}

/**
 * Consolidates the provided source upload against the revised uploads. It also
 * saves the resulting docx document to the users macro cloud via DSS.
 * @returns the consolidated documents documentMetadata as well as the revision
 * count.
 */
export type Consolidate = z.infer<typeof Consolidate>;

const ConsolidateResponseDataUploadCompleteSchema = z.object({
  documentMetadata: DocxDocumentMetadataSchema,
  insertions: z.number(),
  deletions: z.number(),
});

const ConsolidateResponseDataUploadUnzippedSchema = z.object({
  bomParts: z.array(DocxBomPartSchema),
});

export type ConsolidateResponseDataUploadComplete = z.infer<
  typeof ConsolidateResponseDataUploadCompleteSchema
>;
export type ConsolidateResponseDataUploadUnzipped = z.infer<
  typeof ConsolidateResponseDataUploadUnzippedSchema
>;

const ConsolidateResponseData = z.union([
  ConsolidateResponseDataUploadCompleteSchema,
  ConsolidateResponseDataUploadUnzippedSchema,
]);

export function consolidate_upload_response(
  data: unknown
): data is ConsolidateResponseDataUploadComplete {
  return ConsolidateResponseDataUploadCompleteSchema.safeParse(data).success;
}

export function consolidate_unzip_response(
  data: unknown
): data is ConsolidateResponseDataUploadUnzipped {
  return ConsolidateResponseDataUploadUnzippedSchema.safeParse(data).success;
}

function _consolidate_response_data_validate(
  data: unknown
): data is ConsolidateResponseData {
  return ConsolidateResponseData.safeParse(data).success;
}

export type ConsolidateResponseData = z.infer<typeof ConsolidateResponseData>;

const ConsolidateResponse = BaseResponse.extend({
  data: ConsolidateResponseData.optional(),
});

export function consolidate_response_validate(data: {
  [name: string]: unknown;
}) {
  return ConsolidateResponse.parse(data);
}

export type ConsolidateResponse = z.infer<typeof ConsolidateResponse>;
