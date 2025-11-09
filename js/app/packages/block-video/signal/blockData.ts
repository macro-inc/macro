import { blockDataSignalAs, useBlockId } from '@core/block';
import { isErr } from '@core/util/maybeResult';
import { fetchPresigned } from '@service-storage/util/fetchPresigned';
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

export const useGetFileBlob = () => {
  const getPresignedUrl = useGetFileUrl();

  const fetchFromPresignedUrl = async (url: string) => {
    const maybeResult = await fetchPresigned(url, 'blob');
    if (isErr(maybeResult)) {
      throw new Error('unable to fetch from presigned url');
    }

    const [, blob] = maybeResult;
    if (!blob) {
      throw new Error('no blob data');
    }

    return blob;
  };

  const getBlob = async () => {
    const url = await getPresignedUrl();
    const blob = await fetchFromPresignedUrl(url);
    return blob;
  };

  return getBlob;
};
