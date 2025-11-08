import { z } from 'zod';
import { BaseResponse } from '../baseResponse';

const Modify = z.object({
  // The document key to retreive from s3
  // {owner}/{documentId}/{documentInstanceId}.pdf
  documentKey: z.string().endsWith('.pdf'),
  // The SHA256 hash of the pdf
  sha: z.string(),
  // The pdf modification data
  // TODO: type fully later
  modificationData: z.any(),
  // Should the bookmarks be saved
  shouldSaveBookmarks: z.boolean(),
});

export function modify_validate(data: { [name: string]: any }) {
  const result = Modify.safeParse(data);
  if (result.success) {
    return result.data;
  }
  throw result.error;
}

/**
 * @deprecated
 * A job used to test a portion of the save functionality for pdfs.
 * Not to be used in actual app.
 */
export type Modify = z.infer<typeof Modify>;

const ModifyResponseDataSchema = z.object({
  // The s3 presigned url to fetch the resulting document from
  resultUrl: z.string(),
});

export type ModifyResponseData = z.infer<typeof ModifyResponseDataSchema>;

const ModifyResponse = BaseResponse.extend({
  data: ModifyResponseDataSchema.optional(),
});

export function modify_response_validate(data: { [name: string]: any }) {
  const result = ModifyResponse.safeParse(data);
  if (result.success) {
    return result.data;
  }
  throw result.error;
}

export type ModifyResponse = z.infer<typeof ModifyResponse>;

export function modify_response_data_validate(
  data: any
): data is ModifyResponseData {
  const result = ModifyResponseDataSchema.safeParse(data);
  if (result.success) {
    return true;
  }
  return false;
}
