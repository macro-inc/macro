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

/**
 * Resolve local, public, static-file and document-service media sources.
 * Stored media can carry a null or omitted source type and id; the id reaches
 * its endpoints by interpolation, as it always did. A local or public source
 * resolves to its stored url as it is, so a stored video url comes back null
 * or omitted when it was stored so.
 */
export async function getMediaUrl<Url extends string | null | undefined>(src: {
  type: string | null | undefined;
  id: string | null | undefined;
  url: Url;
}): Promise<
  Result<string | Url, ResultError<FetchError | 'INVALID_DOCUMENT'>[]>
> {
  if (src.type === 'local' || src.type === 'url') return ok(src.url);
  return resolveStoredMediaUrl(src);
}

/**
 * Resolve a static-file or document-service media source to its url, which is
 * always text. Any other source type resolves to an empty url after the same
 * warning, which logs the stored source as it is.
 */
export async function resolveStoredMediaUrl(src: {
  type: string | null | undefined;
  id: string | null | undefined;
  url: string | null | undefined;
}): Promise<Result<string, ResultError<FetchError | 'INVALID_DOCUMENT'>[]>> {
  if (src.type === 'sfs') {
    const url = staticFileIdEndpoint(`${src.id}`);
    return ok(url);
  }
  if (src.type === 'dss') {
    return (await fetchBinaryDocumentData(`${src.id}`)).map(
      (res) => res.blobUrl
    );
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
