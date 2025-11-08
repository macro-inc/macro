import { z } from 'zod';
import { BaseResponse } from '../baseResponse';

const Convert = z.object({
  // The document key to retreive from s3
  // {owner}/{documentId}/{documentInstanceId}.pdf
  // or temp_files/{job_id}-{uuid}.pdf
  documentKey: z.string(),
  // extension of document
  documentExtension: z.enum(['pdf', 'docx']),
  // The SHA256 hash of the pdf
  sha: z.string(),
  // The extension to convert to
  toExtension: z.enum(['pdf', 'docx']),
});

export function convert_validate(data: { [name: string]: any }) {
  const result = Convert.safeParse(data);
  if (result.success) {
    return result.data;
  }
  throw result.error;
}

/**
 * Given a DSS document, this job will convert that document into the specified
 * format.
 * @returns the s3 presigned url to get the converted document.
 */
export type Convert = z.infer<typeof Convert>;

const ConvertResponseDataSchema = z.object({
  resultUrl: z.string(),
  resultKey: z.string(),
});

export type ConvertResponseData = z.infer<typeof ConvertResponseDataSchema>;

const ConvertResponse = BaseResponse.extend({
  data: ConvertResponseDataSchema.optional(),
});

export function convert_response_validate(data: { [name: string]: any }) {
  const result = ConvertResponse.safeParse(data);
  if (result.success) {
    return result.data;
  }
  throw result.error;
}

export function convert_response_data_validate(
  data: any
): data is ConvertResponseData {
  const result = ConvertResponseDataSchema.safeParse(data);
  if (result.success) {
    return true;
  }
  return false;
}

export type ConvertResponse = z.infer<typeof ConvertResponse>;
