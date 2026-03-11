import { z } from 'zod';
import { BaseResponse } from '../baseResponse';

const Convert = z.object({
  documentKey: z.string(),
  documentExtension: z.enum(['pdf', 'docx']),
  sha: z.string(),
  toExtension: z.enum(['pdf', 'docx']),
});

export function convert_validate(data: { [name: string]: unknown }) {
  return Convert.parse(data);
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

export function convert_response_validate(data: { [name: string]: unknown }) {
  return ConvertResponse.parse(data);
}

export function convert_response_data_validate(
  data: unknown
): data is ConvertResponseData {
  return ConvertResponseDataSchema.safeParse(data).success;
}

export type ConvertResponse = z.infer<typeof ConvertResponse>;
