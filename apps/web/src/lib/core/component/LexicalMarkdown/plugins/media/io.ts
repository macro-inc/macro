import { blockNameToFileExtensionSet } from '@core/constant/allBlocks';
import { staticFileIdEndpoint } from '@core/constant/servers';
import { heicConversionService } from '@core/heic/service';
import type { FetchError } from '@core/service';
import type { ResultError } from '@core/util/result';
import {
  createStaticUploadFile,
  createUploadFile,
  type UploadFile,
} from '@core/util/uploadFile';
import { fetchBinaryDocumentData } from '@queries/storage/binary-document';
import { fileExtension } from '@service-storage/util/filename';
import { ok, type Result, ResultAsync } from 'neverthrow';

export type MediaType = 'image' | 'video';

export function validateMediaFile(
  file: UploadFile,
  mediaType: MediaType
): boolean {
  const ext = fileExtension(file.name);
  return ext != null && blockNameToFileExtensionSet[mediaType].has(ext);
}

/** Resolve local, public, static-file and document-service media sources. */
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

export async function processFile(file: UploadFile): Promise<UploadFile> {
  if (file.kind === 'browser' && heicConversionService.canConvert(file.file)) {
    return createUploadFile(await heicConversionService.convertFile(file.file));
  }
  return file;
}

/**
 * Upload a file to the static file service. Resolves to its static file id, or
 * undefined when the upload fails.
 */
export async function uploadStaticFile(
  file: File
): Promise<string | undefined> {
  const uploaded = await ResultAsync.fromPromise(
    processFile(createUploadFile(file)),
    () => undefined
  ).andThen((processed) =>
    ResultAsync.fromPromise(createStaticUploadFile(processed), () => undefined)
  );
  return uploaded.unwrapOr(undefined);
}
