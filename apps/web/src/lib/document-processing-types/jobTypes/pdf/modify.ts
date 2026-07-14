import { z } from 'zod';
import { BaseResponse } from '../baseResponse';

const Modify = z.object({
  documentKey: z.string(),
  sha: z.string(),
  modificationData: z.any(),
  shouldSaveBookmarks: z.boolean(),
});

export function modify_validate(data: { [name: string]: unknown }) {
  return Modify.parse(data);
}

/**
 * @deprecated
 * A job used to test a portion of the save functionality for pdfs.
 * Not to be used in actual app.
 */
export type Modify = z.infer<typeof Modify>;

const ModifyResponseDataSchema = z.object({
  resultUrl: z.string(),
});

export type ModifyResponseData = z.infer<typeof ModifyResponseDataSchema>;

const ModifyResponse = BaseResponse.extend({
  data: ModifyResponseDataSchema.optional(),
});

export function modify_response_validate(data: { [name: string]: unknown }) {
  return ModifyResponse.parse(data);
}

export type ModifyResponse = z.infer<typeof ModifyResponse>;

export function modify_response_data_validate(
  data: unknown
): data is ModifyResponseData {
  return ModifyResponseDataSchema.safeParse(data).success;
}
