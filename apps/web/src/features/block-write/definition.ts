import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import { fetchSyncDocumentOpenContext } from '@queries/storage/documentLoad/sync-document-context';
import { err, ok } from 'neverthrow';
import { lazy } from 'solid-js';

/**
 * The collaborative DOCX editor. It owns the `write` block name, which is the
 * DOCX block; when `enable-docx-editor` is off, `write` resolves to the PDF
 * rendering instead (see `fileTypeToBlockName`).
 */
export const definition = defineBlock({
  name: 'write',
  description: 'Edit Word documents together',
  accepted: {
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  component: lazy(() => import('./DocxBlock')),
  liveTrackingEnabled: true,
  syncServiceEnabled: true,
  editPermissionEnabled: true,
  async load(source, intent) {
    if (source.type !== 'sync-service') return LoadErrors.INVALID;
    if (intent === 'preload') return ok({ type: 'preload', origin: source });
    // The same open context as the other sync-service blocks: a token plus a
    // session-bound authorization that re-checks access on reconnect.
    const context = await fetchSyncDocumentOpenContext(source.id);
    if (context.isErr()) return err(context.error);
    return ok(context.value);
  },
});

export type DocxBlockData = ExtractLoadType<(typeof definition)['load']>;
