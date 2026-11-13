import { contentHash, toHex } from '@core/util/hash';
import { getWebOrigin } from '@core/util/webOrigin';
import { v7 as uuidv7 } from 'uuid';
import { createBrowserChangeFeed } from './queries/change-feed';
import { createIndexedDbDocumentBlobs } from './queries/document-blobs';
import { createBrowserExclusive } from './queries/exclusive';
import { buildExecutedPdf } from './queries/executed-pdf';
import {
  createLocalContracts,
  type LocalContracts,
  localContractsStorageKey,
  scopeForSigningToken,
} from './queries/local-contracts';
import { openPdfDocument } from './queries/pdf-document';

const TOKEN_BYTES = 32;

/**
 * Contracts backed by this browser's own storage, kept apart per `scope`: one
 * signed-in account's packets and documents are never shown to another. The
 * workspace and the signing page each create one; a change feed keeps them in
 * step, including across tabs. Create it under a Solid owner.
 */
export function createBrowserContracts(scope: string): LocalContracts {
  const storageKey = localContractsStorageKey(scope);
  return createLocalContracts({
    storage: window.localStorage,
    storageKey,
    blobs: createIndexedDbDocumentBlobs(`macro-contracts-documents:${scope}`),
    changes: createBrowserChangeFeed(`macro-contracts:${scope}`, storageKey),
    exclusive: createBrowserExclusive(storageKey),
    openPdf: openPdfDocument,
    buildExecutedPdf,
    digestText: (text) => contentHash(new TextEncoder().encode(text)),
    digestBytes: contentHash,
    clock: () => new Date().toISOString(),
    newId: uuidv7,
    newToken: () => toHex(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES))),
    signingUrl: (token) => `${getWebOrigin()}/app/sign/${token}`,
  });
}

/**
 * The store that holds a signing link's packet, whichever account sent it,
 * or `undefined` when no account in this browser issued the link.
 */
export function createBrowserContractsForToken(
  token: string
): LocalContracts | undefined {
  const scope = scopeForSigningToken(window.localStorage, token);
  return scope === undefined ? undefined : createBrowserContracts(scope);
}
