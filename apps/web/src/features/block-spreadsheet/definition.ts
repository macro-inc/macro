import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import { lazy } from '@core/util/lazy';
import { fetchSyncDocumentOpenContext } from '@queries/storage/documentLoad/sync-document-context';
import { createSyncServiceSource } from '@service-sync/source';
import { err, ok } from 'neverthrow';

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
    if (source.type !== 'sync-service') return LoadErrors.INVALID;
    if (intent === 'preload') return ok({ type: 'preload', origin: source });
    const context = await fetchSyncDocumentOpenContext(source.id);
    if (context.isErr()) return err(context.error);
    const { source: syncSource, doInitialSync } = createSyncServiceSource(
      source.id,
      context.value.token,
      context.value.authorization
    );
    return ok({
      documentMetadata: context.value.documentMetadata,
      userAccessLevel: context.value.userAccessLevel,
      syncSource,
      doInitialSync,
    });
  },
});

export type SpreadsheetData = ExtractLoadType<(typeof definition)['load']>;
