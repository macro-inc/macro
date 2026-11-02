import { staticFileIdEndpoint } from '@core/constant/servers';
import type { FetchError } from '@core/service';
import type { ResultError } from '@core/util/result';
import {
  $isImageNode,
  $isVideoNode,
  type MediaType,
} from '@macro-inc/lexical-core';
import { fetchBinaryDocumentData } from '@queries/storage/binary-document';
import { $getNodeByKey, type NodeKey } from 'lexical';
import { ok, type Result } from 'neverthrow';

/**
 * Get the URL for media based on its source type.
 */
export async function getMediaUrl(src: {
  type: string;
  id: string;
  url: string;
}): Promise<Result<string, ResultError<FetchError | 'INVALID_DOCUMENT'>[]>> {
  if (src.type === 'local' || src.type === 'url') return ok(src.url);
  if (src.type === 'sfs') {
    const url = staticFileIdEndpoint(src.id);
    return ok(url);
  }
  if (src.type === 'dss') {
    return (await fetchBinaryDocumentData(src.id)).map((res) => res.blobUrl);
  }
  console.warn('Get media url failed for src:', src);
  return ok('');
}

/**
 * Upgrade DSS media URL after document checks.
 */
export function $upgradeDSSMediaUrl(
  key: NodeKey,
  url: string,
  mediaType: MediaType
) {
  const node = $getNodeByKey(key);
  if (!node) return;

  if (mediaType === 'image' && $isImageNode(node)) {
    node.setUrl(url, false);
  } else if (mediaType === 'video' && $isVideoNode(node)) {
    node.setUrl(url, false);
  }
}
