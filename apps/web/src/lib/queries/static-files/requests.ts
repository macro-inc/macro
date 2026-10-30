import { staticFileClient } from '@service-static-files/client';

export const createUploadUrl: typeof staticFileClient.makePresignedUrl = (
  ...args
) => staticFileClient.makePresignedUrl(...args);

export const uploadFileContent: typeof staticFileClient.uploadToPresignedUrl = (
  ...args
) => staticFileClient.uploadToPresignedUrl(...args);
