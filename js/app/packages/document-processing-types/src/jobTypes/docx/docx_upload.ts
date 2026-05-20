import { z } from 'zod';
import { BaseResponse } from '../baseResponse';
import { DocxBomPartSchema } from '../documentMetadata';

const DocxUpload = z.object({});

export function docx_upload_validate(data: { [name: string]: unknown }) {
  return DocxUpload.parse(data);
}

/**
 * DocxUpload initiates the docx upload process. It is used
 * to create a new docx upload job in the DocxUploadJob table. This job is
 * then used to track the progress of the docx upload process.
 * @returns success boolean indicating if the docx was successfully unzipped
 */
export type DocxUpload = z.infer<typeof DocxUpload>;

const DocxUploadResponseDataUploadCompleteSchema = z.object({
  success: z.boolean(),
});

const DocxUploadResponseDataUploadUnzippedSchema = z.object({
  bomParts: z.array(DocxBomPartSchema),
});

export type DocxUploadResponseDataUploadComplete = z.infer<
  typeof DocxUploadResponseDataUploadCompleteSchema
>;
export type DocxUploadResponseDataUploadUnzipped = z.infer<
  typeof DocxUploadResponseDataUploadUnzippedSchema
>;

const DocxUploadResponseData = z.union([
  DocxUploadResponseDataUploadCompleteSchema,
  DocxUploadResponseDataUploadUnzippedSchema,
]);

export function docx_upload_ready_response(
  data: unknown
): data is DocxUploadResponseDataUploadComplete {
  return DocxUploadResponseDataUploadCompleteSchema.safeParse(data).success;
}

export function docx_upload_unzip_response(
  data: unknown
): data is DocxUploadResponseDataUploadUnzipped {
  return DocxUploadResponseDataUploadUnzippedSchema.safeParse(data).success;
}

function _docx_upload_response_data_validate(
  data: unknown
): data is DocxUploadResponseData {
  return DocxUploadResponseData.safeParse(data).success;
}

export type DocxUploadResponseData = z.infer<typeof DocxUploadResponseData>;

const DocxUploadResponse = BaseResponse.extend({
  data: DocxUploadResponseData.optional(),
});

export function docx_upload_response_validate(data: {
  [name: string]: unknown;
}) {
  return DocxUploadResponse.parse(data);
}

export type DocxUploadResponse = z.infer<typeof DocxUploadResponse>;
