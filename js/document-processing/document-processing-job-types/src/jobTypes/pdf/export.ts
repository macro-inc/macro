import { z } from 'zod';
import { BaseResponse } from '../baseResponse';

const Export = z.object({
  // The id of the pdf to export, will use the latest version of the document
  documentId: z.string(),
});

export function export_validate(data: { [name: string]: any }) {
  const result = Export.safeParse(data);
  if (result.success) {
    return result.data;
  }
  throw result.error;
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

export function export_response_validate(data: { [name: string]: any }) {
  const result = ExportResponse.safeParse(data);
  if (result.success) {
    return result.data;
  }
  throw result.error;
}

export function export_response_data_validate(
  data: any
): data is ExportResponseData {
  const result = ExportResponseDataSchema.safeParse(data);
  if (result.success) {
    return true;
  }
  return false;
}

export type ExportResponse = z.infer<typeof ExportResponse>;
