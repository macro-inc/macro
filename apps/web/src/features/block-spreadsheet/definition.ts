import {
  defineBlock,
  type ExtractLoadType,
  LoadErrors,
  loadResult,
} from '@core/block';
import { fetchDocumentLocation } from '@queries/storage/document-location';
import { fetchDocumentLoadBundle } from '@queries/storage/documentLoad/documentLoadBundle';
import { createSyncServiceSource } from '@service-sync/source';
import { err, ok } from 'neverthrow';
import { lazy } from 'solid-js';
import { isSpreadsheetEnabledForCurrentUser } from './queries/spreadsheet-access';

export const definition = defineBlock({
  name: 'spreadsheet',
  description: 'Calculate, organize, and collaborate in a spreadsheet',
  defaultFilename: 'New Spreadsheet',
  accepted: { spreadsheet: 'application/x-macro-spreadsheet' },
  component: lazy(() => import('./SpreadsheetBlock')),
  liveTrackingEnabled: true,
  syncServiceEnabled: true,
  editPermissionEnabled: true,
  async load(source, intent) {
    if (!isSpreadsheetEnabledForCurrentUser()) return LoadErrors.UNAUTHORIZED;
    if (source.type !== 'sync-service') return LoadErrors.INVALID;
    if (intent === 'preload') return ok({ type: 'preload', origin: source });
    const [bundle, location] = await Promise.all([
      fetchDocumentLoadBundle(source.id),
      loadResult(fetchDocumentLocation({ documentId: source.id })),
    ]);
    if (bundle.isErr()) return err(bundle.error);
    if (location.isErr()) return err(location.error);
    if (location.value.type !== 'syncServiceContent') return LoadErrors.INVALID;
    const { source: syncSource, doInitialSync } = createSyncServiceSource(
      source.id,
      bundle.value.token
    );
    return ok({
      documentMetadata: bundle.value.documentMetadata,
      userAccessLevel: bundle.value.userAccessLevel,
      syncSource,
      doInitialSync,
    });
  },
});

export type SpreadsheetData = ExtractLoadType<(typeof definition)['load']>;
