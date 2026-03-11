import { z } from 'zod';
import { BaseResponse } from '../baseResponse';

const Export = z.object({
  documentId: z.string(),
});

export function export_validate(data: { [name: string]: unknown }) {
  return Export.parse(data);
}

/**
 * Given a DSS document, this job will apply the modification data to the pdf and
 * return a presigned url you can use to download the modified pdf.
 * @returns the s3 presigned url to get the converted document.
 */
export type Export = z.infer<typeof Export>;

const ExportResponseDataSchema = z.object({
  resultUrl: z.string(),
});

export type ExportResponseData = z.infer<typeof ExportResponseDataSchema>;

const ExportResponse = BaseResponse.extend({
  data: ExportResponseDataSchema.optional(),
});

export function export_response_validate(data: { [name: string]: unknown }) {
  return ExportResponse.parse(data);
}

export function export_response_data_validate(
  data: unknown
): data is ExportResponseData {
  return ExportResponseDataSchema.safeParse(data).success;
}

export type ExportResponse = z.infer<typeof ExportResponse>;
