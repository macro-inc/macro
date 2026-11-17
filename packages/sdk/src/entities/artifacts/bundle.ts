import type {
  ArtifactUploadResponse,
  FileInputBody,
  SceneBody,
} from '../../../generated/storage/types.gen';
import { MacroApiError, MacroError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { Artifact } from './artifact';

/**
 * Largest create or publish request the API accepts (32 MiB). A version that
 * fits goes inline in one request; above it the largest files go through
 * presigned uploads.
 *
 * @internal
 */
export const MAX_PUBLISH_REQUEST_BYTES = 32 * 1024 * 1024;

/**
 * One file of a version: its text (stored as UTF-8), its bytes, or the file at
 * `path` in another artifact's current version.
 */
export type ArtifactFileSource =
  | string
  | Uint8Array
  | { artifact: Artifact; path: string };

/** A version's files by relative path; `index.html` is required. */
export type ArtifactFiles = Record<string, ArtifactFileSource>;

/** A named page of a version, the unit people share and place on canvases. */
export interface ArtifactSceneInput {
  /** Slug: lowercase letters, digits and dashes, unique in the version. */
  id: string;
  /** Display title. */
  title: string;
  /** The page, one of the version's file paths. */
  path: string;
}

/** Content types by file extension, from the API's allowlist. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
  txt: 'text/plain',
  md: 'text/markdown',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  pdf: 'application/pdf',
  wasm: 'application/wasm',
};

/** Bytes a file's `content_base64` field adds to a request body. */
const CONTENT_FIELD_BYTES = ',"content_base64":""'.length;

/** @internal The content type a path's extension names. */
export function contentTypeOf(path: string): string {
  const name = path.split('/').pop() ?? '';
  const extension = name.includes('.')
    ? name.split('.').pop()?.toLowerCase()
    : undefined;
  const type = extension === undefined ? undefined : CONTENT_TYPES[extension];
  if (type === undefined)
    throw new MacroError(
      `${path} needs one of the extensions ${Object.keys(CONTENT_TYPES).join(', ')}`,
    );
  return type;
}

/** @internal Hex SHA-256 of `bytes`, with WebCrypto. */
export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

/** @internal Standard base64, in chunks so large files don't overflow the call stack. */
export function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(binary);
}

/** Length of the base64 of `size` bytes. */
const base64Length = (size: number) => Math.ceil(size / 3) * 4;

/** A file ready to publish. */
interface PreparedFile {
  path: string;
  contentType: string;
  sha256: string;
  size: number;
  /** Where the bytes live when the SDK does not have them. */
  copiedFrom?: { artifact: Artifact; path: string };
}

/** @internal A version's files with their digests, and the bytes the SDK holds. */
export interface PreparedBundle {
  files: PreparedFile[];
  /** Bytes by digest. */
  bytes: Map<string, Uint8Array<ArrayBuffer>>;
}

/** @internal Hash every file; files copied from other artifacts take their digests. */
export async function prepareBundle(
  files: ArtifactFiles,
): Promise<PreparedBundle> {
  const bytes = new Map<string, Uint8Array<ArrayBuffer>>();
  const prepared = await Promise.all(
    Object.entries(files).map(async ([path, source]): Promise<PreparedFile> => {
      if (typeof source === 'string' || source instanceof Uint8Array) {
        const content =
          typeof source === 'string'
            ? new TextEncoder().encode(source)
            : new Uint8Array(source);
        const sha256 = await sha256Hex(content);
        bytes.set(sha256, content);
        return {
          path,
          contentType: contentTypeOf(path),
          sha256,
          size: content.byteLength,
        };
      }
      const current = await source.artifact.currentVersion();
      const file = (await current?.files())?.find(
        (candidate) => candidate.path === source.path,
      );
      if (!file)
        throw new MacroError(
          `artifact ${source.artifact.id} has no ${source.path} in its current version`,
        );
      return {
        path,
        contentType: file.contentType,
        sha256: file.sha256,
        size: file.size,
        copiedFrom: source,
      };
    }),
  );
  return { files: prepared, bytes };
}

/** @internal Whether every file's bytes are in hand. */
export function isComplete(bundle: PreparedBundle): boolean {
  return bundle.files.every((file) => bundle.bytes.has(file.sha256));
}

/** @internal The wire form of a version's scenes. */
export function sceneBodies(scenes?: ArtifactSceneInput[]): SceneBody[] {
  return (scenes ?? []).map((scene) => ({ ...scene }));
}

/** The request's files, carrying content for the digests in `inline`. */
function fileInputs(
  bundle: PreparedBundle,
  inline: ReadonlySet<string>,
): FileInputBody[] {
  return bundle.files.map((file) => {
    const content = inline.has(file.sha256)
      ? bundle.bytes.get(file.sha256)
      : undefined;
    return {
      path: file.path,
      content_type: file.contentType,
      sha256: file.sha256,
      ...(content ? { content_base64: base64(content) } : {}),
    };
  });
}

/**
 * Size of a request body carrying content for the digests in `inline`: every
 * file with such a digest carries it, since a file sent without content must
 * already be stored.
 */
function requestBytes(
  bundle: PreparedBundle,
  rest: Record<string, unknown>,
  inline: ReadonlySet<string>,
): number {
  const body = JSON.stringify({
    ...rest,
    files: fileInputs(bundle, new Set()),
  });
  return bundle.files.reduce(
    (total, file) =>
      inline.has(file.sha256)
        ? total + CONTENT_FIELD_BYTES + base64Length(file.size)
        : total,
    new TextEncoder().encode(body).byteLength,
  );
}

/**
 * Every file inline, for creating an artifact in one request; `undefined`
 * when a file's bytes are elsewhere or the body would exceed 32 MiB.
 *
 * @internal
 */
export function inlineFiles(
  bundle: PreparedBundle,
  rest: Record<string, unknown>,
): FileInputBody[] | undefined {
  if (!isComplete(bundle)) return undefined;
  const inline = new Set(bundle.bytes.keys());
  return requestBytes(bundle, rest, inline) <= MAX_PUBLISH_REQUEST_BYTES
    ? fileInputs(bundle, inline)
    : undefined;
}

/** The bytes of another artifact's file, read from its own origin. */
async function download(
  client: MacroClient,
  file: PreparedFile,
  source: { artifact: Artifact; path: string },
): Promise<Uint8Array<ArrayBuffer>> {
  const { url } = unwrap(
    await client.storage.getArtifactViewUrl({
      path: { document_id: source.artifact.id },
      body: {},
    }),
  );
  const response = await fetch(
    new URL(source.path.split('/').map(encodeURIComponent).join('/'), url),
  );
  if (!response.ok)
    throw new MacroApiError(response.status, {
      message: `failed to copy ${source.path} from artifact ${source.artifact.id}`,
    });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if ((await sha256Hex(bytes)) !== file.sha256)
    throw new MacroError(
      `${source.path} of artifact ${source.artifact.id} changed while it was copied`,
    );
  return bytes;
}

async function put(upload: ArtifactUploadResponse, bytes: Uint8Array) {
  const response = await fetch(upload.url, {
    method: 'PUT',
    headers: upload.headers,
    body: new Uint8Array(bytes),
  });
  if (!response.ok)
    throw new MacroApiError(response.status, {
      message: `upload of ${upload.sha256} failed`,
    });
}

/**
 * Store what `artifact` lacks and return the publish body's files. Files it
 * already stores go by digest. Missing ones go inline while the request fits
 * 32 MiB; above that the largest go through presigned uploads, which code
 * mode cannot reach (it reaches only Macro's API), so there a version's new
 * bytes must fit one request.
 *
 * @internal
 */
export async function stageBundle(
  client: MacroClient,
  artifact: Artifact,
  bundle: PreparedBundle,
  rest: Record<string, unknown>,
): Promise<FileInputBody[]> {
  const byDigest = new Map(bundle.files.map((file) => [file.sha256, file]));
  const { uploads } = unwrap(
    await client.storage.createArtifactUploads({
      path: { document_id: artifact.id },
      body: {
        files: [...byDigest.values()].map((file) => ({
          sha256: file.sha256,
          size: file.size,
          content_type: file.contentType,
        })),
      },
    }),
  );

  for (const upload of uploads) {
    const file = byDigest.get(upload.sha256);
    if (!file || bundle.bytes.has(file.sha256)) continue;
    if (!file.copiedFrom || file.copiedFrom.artifact.id === artifact.id)
      throw new MacroError(`${file.path} is not stored for this artifact`);
    bundle.bytes.set(
      file.sha256,
      await download(client, file, file.copiedFrom),
    );
  }

  // Largest first, so the fewest files leave the request.
  const missing = [...uploads].sort(
    (a, b) =>
      (bundle.bytes.get(b.sha256)?.byteLength ?? 0) -
      (bundle.bytes.get(a.sha256)?.byteLength ?? 0),
  );
  const inline = new Set(missing.map((upload) => upload.sha256));
  const uploaded: ArtifactUploadResponse[] = [];
  for (const upload of missing) {
    if (requestBytes(bundle, rest, inline) <= MAX_PUBLISH_REQUEST_BYTES) break;
    inline.delete(upload.sha256);
    uploaded.push(upload);
  }

  await Promise.all(
    uploaded.map((upload) => {
      const bytes = bundle.bytes.get(upload.sha256);
      if (!bytes) throw new MacroError(`no bytes for ${upload.sha256}`);
      return put(upload, bytes);
    }),
  );
  return fileInputs(bundle, inline);
}
