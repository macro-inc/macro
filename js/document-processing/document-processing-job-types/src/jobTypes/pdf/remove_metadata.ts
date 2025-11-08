import { z } from 'zod';
import { BaseResponse } from '../baseResponse';

const RemoveMetadata = z.object({
  // The document key to retreive from s3
  // {owner}/{documentId}/{documentInstanceId}.pdf
  documentKey: z.string().endsWith('.pdf'),
  // The SHA256 hash of the pdf
  sha: z.string(),
});

export function remove_metadata_validate(data: { [name: string]: any }) {
  const result = RemoveMetadata.safeParse(data);
  if (result.success) {
    return result.data;
  }
  throw result.error;
}

/**
 * Removes all metadata from the provided pdf.
 * @returns the presigned url to download the stripped pdf.
 */
export type RemoveMetadata = z.infer<typeof RemoveMetadata>;

const RemoveMetadataResponse = BaseResponse.extend({
  data: z
    .object({
      resultUrl: z.string(),
    })
    .optional(),
});

export function remove_metadata_response_validate(data: {
  [name: string]: any;
}) {
  const result = RemoveMetadataResponse.safeParse(data);
  if (result.success) {
    return result.data;
  }
  throw result.error;
}

export type RemoveMetadataResponse = z.infer<typeof RemoveMetadataResponse>;
