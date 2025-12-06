import type { FlattenObject } from '@core/util/flatten';
import {
  err,
  isErr,
  type MaybeResult,
  ok,
  type ResultError,
} from '@core/util/maybeResult';
import type { WithRequired } from '@core/util/withRequired';
import type { AccessLevel as UserAccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';
import { fetchBinary } from './fetchBinary';
import { getOPFSDocumentStore } from './opfs';
import type { StorageError } from './storageError';

export type DocxBaseExpandedPart<T> = {
  path: string;
  sha: string;
  content: T;
};

export type DocxExpandedPart = DocxBaseExpandedPart<ArrayBuffer>;

export type DocxExpandedPartWithoutSha = Omit<DocxExpandedPart, 'sha'>;

export type DocxExpandedParts = DocxExpandedPart[];
export type DocxExpandedPartList = Omit<DocxExpandedPart, 'content'>[];

export type DocxExpandedFile = {
  parts: DocxExpandedParts;
  metadata: WithRequired<DocumentMetadata, 'documentBom'>;
};

export type GetDocxFileResponse = FlattenObject<{
  parts: Array<{ sha: string; url: string }>;
  metadata: WithRequired<DocumentMetadata, 'documentBom'>;
  canEdit: boolean;
  userAccessLevel: UserAccessLevel;
}>;

export async function getDocxExpandedParts(
  docxFile: GetDocxFileResponse
): Promise<MaybeResult<StorageError, DocxExpandedPart[]>> {
  const { documentId, documentBom } = docxFile.metadata;
  let opfsDocumentStore;
  try {
    opfsDocumentStore = await getOPFSDocumentStore();
  } catch (error) {
    return err(
      'OPFS_ERROR',
      `Failed to get OPFS document store: ${error.message}`
    );
  }

  let opfsDocHandle;
  try {
    const result = await opfsDocumentStore.get(documentId, { create: true });
    opfsDocHandle = result.document;
  } catch (error) {
    return err(
      'OPFS_ERROR',
      `Failed to get OPFS document handle for ${documentId}: ${error.message}`
    );
  }

  if (!opfsDocHandle) {
    return err(
      'OPFS_ERROR',
      `Failed to get OPFS document handle for ${documentId}`
    );
  }

  let opfsParts: DocxExpandedPartList;
  try {
    opfsParts = await opfsDocHandle.list();
  } catch (error) {
    return err(
      'OPFS_ERROR',
      `Failed to list OPFS parts for ${documentId}: ${error.message}`
    );
  }

  const partPromises = docxFile.parts.map(async (location) => {
    const { url, sha } = location;
    const part = opfsParts.filter((part) => part.sha === sha);

    if (part.length > 0) {
      const partResults = await Promise.all(
        part.map(async (p) => {
          try {
            const { buffer, exists } = await opfsDocHandle.getPart(
              p.path,
              p.sha
            );
            if (!exists || !buffer) {
              console.warn(
                `Part ${p.path}'s content does not exist but is expected to exist`
              );
              await opfsDocHandle.removePart(p.path, p.sha).catch(() => {});
              return null;
            }
            return { sha: p.sha, path: p.path, content: buffer };
          } catch (error) {
            console.warn(`Failed to get part ${p.path}: ${error.message}`);
            return null;
          }
        })
      );
      return ok(
        partResults.filter(
          (result): result is DocxExpandedPart & { content: ArrayBuffer } =>
            result !== null
        )
      );
    }

    const fetchResult = await fetchBinary(url, 'arraybuffer', {
      method: 'GET',
      headers: { 'Content-Type': 'application/octet-stream' },
    });

    if (isErr(fetchResult)) {
      return fetchResult;
    }

    const [, arrayBuffer] = fetchResult;

    const shaMatches = documentBom.filter((bom) => bom.sha === sha);
    if (shaMatches.length === 0) {
      return err(
        'INVALID_DOCUMENT',
        `Failed to find path for ${url}, sha: ${sha}`
      );
    }

    return ok(
      shaMatches.map((match) => ({
        sha: match.sha,
        path: match.path,
        content: arrayBuffer,
      }))
    );
  });

  const settledResults = await Promise.allSettled(partPromises);

  const parts: DocxExpandedPart[] = [];
  const errors: ResultError<StorageError>[] = [];

  settledResults.forEach((result) => {
    if (result.status === 'fulfilled') {
      const [err, part] = result.value;
      if (err) {
        errors.push(...err);
      } else {
        parts.push(...part);
      }
    } else {
      errors.push({
        code: 'UNKNOWN_ERROR',
        message: `Failed to process part: ${result.reason}`,
      });
    }
  });

  if (errors.length > 0) {
    return [errors, null];
  }

  return ok(parts);
}
