import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import { fetchFileDocumentOpenContext } from '@queries/storage/documentLoad/sync-document-context';
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
    // Not the Markdown open context: an uploaded DOCX stays a stored file until
    // an editor seeds it into the sync service, so its location is never
    // sync-service content. The file context keeps the same session-bound
    // sync authorization.
    const context = await fetchFileDocumentOpenContext(source.id);
    if (context.isErr()) return err(context.error);
    return ok(context.value);
  },
});

export type DocxBlockData = ExtractLoadType<(typeof definition)['load']>;
