import { z } from 'zod';
import { BaseResponse } from '../baseResponse';

const CreateTempFile = z.object({
  // SHA256 hash of the pdf (hex)
  sha: z.string(),
  // the extension of the file that will be saved
  // docx or pdf
  extension: z.string(),
});

export function create_temp_file_validate(data: { [name: string]: any }) {
  const result = CreateTempFile.safeParse(data);
  if (result.success) {
    return result.data;
  }
  throw result.error;
}

/**
 * Used to create a temporary file. This is useful for jobs like `pdf_preprocess`
 * or `pdf_ocr_perform` where the user might be making edits to the document
 * and need to have the jobs run against the updated, unsaved document.
 * @returns The presigned PUT url you can use to upload the file.
 * Note: All temp files are automatically disposed of in s3 after 1 day.
 */
export type CreateTempFile = z.infer<typeof CreateTempFile>;

const CreateTempFileResponseDataSchema = z.object({
  // The s3 presigned url to upload the document to
  resultUrl: z.string(),
  resultKey: z.string(),
});

export type CreateTempFileResponseData = z.infer<
  typeof CreateTempFileResponseDataSchema
>;

const CreateTempFileResponse = BaseResponse.extend({
  data: CreateTempFileResponseDataSchema.optional(),
});

export function create_temp_file_response_validate(data: {
  [name: string]: any;
}) {
  const result = CreateTempFileResponse.safeParse(data);
  if (result.success) {
    return result.data;
  }
  throw result.error;
}

export function create_temp_file_response_data_validate(
  data: any
): data is CreateTempFileResponseData {
  const result = CreateTempFileResponseDataSchema.safeParse(data);
  if (result.success) {
    return true;
  }
  return false;
}

export type CreateTempFileResponse = z.infer<typeof CreateTempFileResponse>;
