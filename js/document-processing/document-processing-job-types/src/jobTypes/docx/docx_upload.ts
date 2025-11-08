import { z } from 'zod';
import { BaseResponse } from '../baseResponse';
import { DocxBomPartSchema } from '../documentMetadata';

// userId is required
const DocxUpload = z.object({});

export function docx_upload_validate(data: { [name: string]: any }) {
  const result = DocxUpload.safeParse(data);
  if (result.success) {
    return result.data;
  }
  throw result.error;
}

/**
 * DocxUpload initiates the docx upload process. It is used
 * to create a new docx upload job in the DocxUploadJob table. This job is
 * then used to track the progress of the docx upload process.
 * @returns success boolean indicating if the docx was successfully unzipped
 */
export type DocxUpload = z.infer<typeof DocxUpload>;

// Used by consumer service to send back the success status that the job
// has been inserted into the db for further processing
const DocxUploadResponseDataUploadCompleteSchema = z.object({
  success: z.boolean(),
});

// Used by docx unzip lambda to send back the bom parts
const DocxUploadResponseDataUploadUnzippedSchema = z.object({
  bomParts: z.array(DocxBomPartSchema),
});

// Used by the convert service to notify the frontend that the
// conversion of docx to pdf has been completed.
const DocxUploadResponseDataConvertSchema = z.object({
  converted: z.boolean(),
});

export type DocxUploadResponseDataUploadComplete = z.infer<
  typeof DocxUploadResponseDataUploadCompleteSchema
>;

export type DocxUploadResponseDataUploadUnzipped = z.infer<
  typeof DocxUploadResponseDataUploadUnzippedSchema
>;

export type DocxUploadResponseDataConvert = z.infer<
  typeof DocxUploadResponseDataConvertSchema
>;

const DocxUploadResponseData = DocxUploadResponseDataUploadCompleteSchema.or(
  DocxUploadResponseDataUploadUnzippedSchema
).or(DocxUploadResponseDataConvertSchema);

export function docx_upload_ready_response(
  data: any
): data is DocxUploadResponseDataUploadComplete {
  const result = DocxUploadResponseDataUploadCompleteSchema.safeParse(data);
  if (result.success) {
    return true;
  }
  return false;
}

export function docx_upload_unzip_response(
  data: any
): data is DocxUploadResponseDataUploadUnzipped {
  const result = DocxUploadResponseDataUploadUnzippedSchema.safeParse(data);
  if (result.success) {
    return true;
  }
  return false;
}

export function docx_upload_convert_response(
  data: any
): data is DocxUploadResponseDataConvert {
  const result = DocxUploadResponseDataConvertSchema.safeParse(data);
  if (result.success) {
    return true;
  }
  return false;
}

export function docx_upload_response_data_validate(
  data: any
): data is DocxUploadResponseData {
  const result = DocxUploadResponseData.safeParse(data);
  if (result.success) {
    return true;
  }
  return false;
}

export type DocxUploadResponseData = z.infer<typeof DocxUploadResponseData>;

const DocxUploadResponse = BaseResponse.extend({
  data: DocxUploadResponseData.optional(),
});

export function docx_upload_response_validate(data: { [name: string]: any }) {
  const result = DocxUploadResponse.safeParse(data);
  if (result.success) {
    return result.data;
  }
  throw result.error;
}

export type DocxUploadResponse = z.infer<typeof DocxUploadResponse>;
