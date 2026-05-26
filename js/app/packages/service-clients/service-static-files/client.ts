import { SERVER_HOSTS } from '@core/constant/servers';
import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import type { ObjectLike, ResultError } from '@core/util/result';
import type { SafeFetchInit } from '@core/util/safeFetch';
import { platformFetch } from 'core/util/platformFetch';
import type { Result } from 'neverthrow';
import type { FileMetadata } from './generated/schemas/fileMetadata';
import type { PutFileRequest } from './generated/schemas/putFileRequest';
import type { PutFileResponse } from './generated/schemas/putFileResponse';

const staticFileHost = `${SERVER_HOSTS['static-file']}`;

function staticFetch(
  url: string,
  init?: SafeFetchInit
): Promise<Result<void, ResultError<FetchWithTokenErrorCode>[]>>;
function staticFetch<T extends ObjectLike>(
  url: string,
  init?: SafeFetchInit
): Promise<Result<T, ResultError<FetchWithTokenErrorCode>[]>>;
function staticFetch<T extends ObjectLike = never>(
  url: string,
  init?: SafeFetchInit
):
  | Promise<Result<T, ResultError<FetchWithTokenErrorCode>[]>>
  | Promise<Result<void, ResultError<FetchWithTokenErrorCode>[]>> {
  return fetchWithToken<T>(`${staticFileHost}${url}`, init);
}

type WithFileId = { file_id: string };

export const staticFileClient = {
  async makePresignedUrl(args: PutFileRequest) {
    return (
      await staticFetch<PutFileResponse>('/api/file', {
        method: 'PUT',
        body: JSON.stringify(args),
      })
    ).map((result) => result);
  },
  async getMetadata(args: WithFileId) {
    return (
      await staticFetch<FileMetadata>(`/api/file/metadata/${args.file_id}`, {
        method: 'GET',
      })
    ).map((result) => result);
  },

  async deleteFile(args: WithFileId) {
    return await staticFetch(`/api/file/${args.file_id}`, {
      method: 'DELETE',
    });
  },

  async getFile(args: WithFileId) {
    return await staticFetch(`/file/${args.file_id}`, { method: 'GET' });
  },

  async uploadToPresignedUrl(args: { url: string; blob: Blob | File }) {
    const result = await platformFetch(args.url, {
      method: 'PUT',
      body: args.blob,
    });
    return { success: result.ok };
  },
};
