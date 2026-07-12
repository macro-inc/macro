import { z } from 'zod';
import { BaseResponse } from '../baseResponse';

const RemoveMetadata = z.object({
  documentKey: z.string(),
  sha: z.string(),
});

export function remove_metadata_validate(data: { [name: string]: unknown }) {
  return RemoveMetadata.parse(data);
}

/**
 * Removes all metadata from the provided pdf.
 * @returns the presigned url to download the stripped pdf.
 */
export type RemoveMetadata = z.infer<typeof RemoveMetadata>;

const RemoveMetadataResponseDataSchema = z.object({
  resultUrl: z.string(),
});

const RemoveMetadataResponse = BaseResponse.extend({
  data: RemoveMetadataResponseDataSchema.optional(),
});

export function remove_metadata_response_validate(data: {
  [name: string]: unknown;
}) {
  return RemoveMetadataResponse.parse(data);
}

export type RemoveMetadataResponse = z.infer<typeof RemoveMetadataResponse>;
