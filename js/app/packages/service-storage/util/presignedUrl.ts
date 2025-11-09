import { isErr } from '@core/util/maybeResult';
import { storageServiceClient } from '../client';

// we expire slightly before the actual expiry to avoid race condition
const EXPIRE_OFFSET_SECONDS = 10;

export const parseExpiryTimeFromPresignedUrl = (
  blobUrl: string
): Date | undefined => {
  try {
    const url = new URL(blobUrl);
    const expires = url.searchParams.get('Expires');
    let expiresAtSeconds = expires ? parseInt(expires, 10) : null;
    if (!expiresAtSeconds) return undefined;
    expiresAtSeconds -= EXPIRE_OFFSET_SECONDS;
    return new Date(expiresAtSeconds * 1000);
  } catch {
    return undefined;
  }
};

export const getPresignedUrl = async ({
  documentId,
  versionId,
  invalidateCache,
}: {
  documentId: string;
  versionId: number;
  invalidateCache?: boolean;
}): Promise<string> => {
  if (invalidateCache) {
    storageServiceClient.getDocumentLocation.invalidate({
      documentId,
      versionId,
    });
  }

  const maybeLocation = await storageServiceClient.getDocumentLocation({
    documentId,
    versionId,
  });
  if (isErr(maybeLocation)) {
    throw new Error('unable to retrieve location data');
  }

  const [, { data }] = maybeLocation;
  if (!('presignedUrl' in data)) {
    throw new Error('presignedUrl not found in location data');
  }

  const url = data.presignedUrl;
  const expires = parseExpiryTimeFromPresignedUrl(url);
  if (expires && new Date() > expires) {
    if (invalidateCache) {
      throw new Error('already refreshed expired presigned url');
    }
    return getPresignedUrl({ documentId, versionId, invalidateCache: true });
  }

  return url;
};
