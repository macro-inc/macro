import { contentHash, toHex } from '@core/util/hash';
import { v7 as uuidv7 } from 'uuid';
import { createBrowserChangeFeed } from '../queries/change-feed';
import { createIndexedDbDocumentBlobs } from '../queries/document-blobs';
import {
  createLocalContracts,
  LOCAL_CONTRACTS_STORAGE_KEY,
} from '../queries/local-contracts';
import { openPdfDocument } from '../queries/pdf-document';

export const FIXTURE_DOCUMENT_STORE = 'macro-contracts-fixture-documents';

/**
 * The real browser-local adapter, pointed at the fixture's own signing page
 * and document store. `?now=` pins the clock so statuses are reproducible.
 */
export function createFixtureContracts() {
  const pinned = new URLSearchParams(location.search).get('now');
  return createLocalContracts({
    storage: window.localStorage,
    blobs: createIndexedDbDocumentBlobs(FIXTURE_DOCUMENT_STORE),
    changes: createBrowserChangeFeed(
      'macro-contracts-fixture',
      LOCAL_CONTRACTS_STORAGE_KEY
    ),
    openPdf: openPdfDocument,
    digestText: (text) => contentHash(new TextEncoder().encode(text)),
    digestBytes: contentHash,
    clock: () => pinned ?? new Date().toISOString(),
    newId: uuidv7,
    newToken: () => toHex(crypto.getRandomValues(new Uint8Array(32))),
    signingUrl: (token) =>
      `${location.origin}/src/features/contracts/browser-test/signing.html?token=${token}`,
  });
}

/** Apply the app's theme tokens; `?theme=light` picks the light theme. */
export async function applyFixtureTheme() {
  const light = new URLSearchParams(location.search).get('theme') === 'light';
  const [{ themeCssVars }, { macroDarkTheme }, { macroLightTheme }] =
    await Promise.all([
      import('../../theme/utils/themeCssVars'),
      import('../../theme/themes/macro-dark'),
      import('../../theme/themes/macro-light'),
    ]);
  document.documentElement.dataset.themeLight = String(light);
  const tokens = themeCssVars(light ? macroLightTheme : macroDarkTheme);
  for (const [key, token] of Object.entries(tokens)) {
    document.documentElement.style.setProperty(key, token);
  }
}
