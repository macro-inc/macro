import { blockDataSignalAs, useBlockId } from '@core/block';

import {
  type FetchProgress,
  fetchPresigned,
  fetchPresignedBlobWithProgress,
} from '@service-storage/util/fetchPresigned';
import { getPresignedUrl } from '@service-storage/util/presignedUrl';
import { createMemo } from 'solid-js';
import type { VideoFileData } from '../definition';

export const blockData = blockDataSignalAs<VideoFileData>('video');

export const useGetFileUrl = () => {
  const documentId = useBlockId();
  const versionIdMemo = createMemo(() => {
    const versionId = blockData()?.documentMetadata?.documentVersionId;
    if (!versionId) throw new Error('no version id');
    return versionId;
  });

  return () => {
    const versionId = versionIdMemo();
    const url = getPresignedUrl({ documentId, versionId });
    return url;
  };
};

type GetBlobOptions = {
  onProgress?: (progress: FetchProgress) => void;
};

export const useGetFileBlob = () => {
  const getPresignedUrl = useGetFileUrl();

  const fetchFromPresignedUrl = async (
    url: string,
    options?: GetBlobOptions
  ) => {
    const result = options?.onProgress
      ? await fetchPresignedBlobWithProgress(url, options.onProgress)
      : await fetchPresigned(url, 'blob');
    if (result.isErr()) {
      throw new Error('unable to fetch from presigned url');
    }

    const blob = result.value;
    if (!blob) {
      throw new Error('no blob data');
    }

    return blob;
  };

  const getBlob = async (options?: GetBlobOptions) => {
    const url = await getPresignedUrl();
    const blob = await fetchFromPresignedUrl(url, options);
    return blob;
  };

  return getBlob;
};
