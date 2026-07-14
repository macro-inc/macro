import { z } from 'zod';
import { BaseResponse } from '../baseResponse';

const PasswordInput = z.object({
  documentId: z.string(),
  documentVersionId: z.number(),
  password: z.string(),
});

export function password_validate(data: { [name: string]: unknown }) {
  return PasswordInput.parse(data);
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
  data: unknown
): data is PasswordResponseData {
  return PasswordResponseDataSchema.safeParse(data).success;
}

const PasswordResponse = BaseResponse.extend({
  data: PasswordResponseDataSchema.optional(),
});

export function password_response_validate(data: { [name: string]: unknown }) {
  return PasswordResponse.parse(data);
}

export type PasswordResponse = z.infer<typeof PasswordResponse>;
