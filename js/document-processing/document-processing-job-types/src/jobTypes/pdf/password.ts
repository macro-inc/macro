import { z } from 'zod';
import { BaseResponse } from '../baseResponse';

const PasswordInput = z.object({
  // The id of the document
  documentId: z.string(),
  // The version id of the document
  // Used in conjunction with the documentId to get the document key to send to
  // preprocess job
  documentVersionId: z.number(),
  // The password
  password: z.string(),
});

export function password_validate(data: { [name: string]: any }) {
  const result = PasswordInput.safeParse(data);
  if (result.success) {
    return result.data;
  }
  throw result.error;
}

/**
 * Used to encrypt the provided document key with the given password.
 * @returns the s3 presigned url to get the encrypted document.
 */
export type PasswordInput = z.infer<typeof PasswordInput>;

const PasswordResponseDataSchema = z.object({
  resultUrl: z.string(),
});

export type PasswordResponseData = z.infer<typeof PasswordResponseDataSchema>;

export function password_response_data_validate(
  data: any
): data is PasswordResponseData {
  const result = PasswordResponseDataSchema.safeParse(data);
  if (result.success) {
    return true;
  }
  return false;
}

const PasswordResponse = BaseResponse.extend({
  data: PasswordResponseDataSchema.optional(),
});

export function password_response_validate(data: { [name: string]: any }) {
  const result = PasswordResponse.safeParse(data);
  if (result.success) {
    return result.data;
  }
  throw result.error;
}

export type PasswordResponse = z.infer<typeof PasswordResponse>;
