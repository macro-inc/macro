import type { BlockName } from '@core/block';
import { fileTypeToResolvedBlockName } from '@core/constant/allBlocks';
import {
  createFileDownload,
  type DownloadSource,
} from '@core/util/createFileDownload';
import { fireAndForget } from '@core/util/fireAndForget';
import type { EntityData } from '@entity';
import {
  exportedDocxDownloadSource,
  storedDocumentDownloadSource,
} from '@queries/storage/document-download';
import { createRoot } from 'solid-js';
import { match } from 'ts-pattern';
import type { EntityActionListState } from './entity-action-context';

/**
 * Where a list row's document downloads from without its editor open, or
 * undefined when only the open editor or viewer can produce the file.
 */
function documentDownloadSource(
  entity: EntityData
): DownloadSource | undefined {
  if (entity.type !== 'document' || !entity.fileType) return undefined;
  const { id, name, fileType } = entity;
  // Storage rebuilds a Word document from its parts, whichever block opens it.
  if (fileType === 'docx') return exportedDocxDownloadSource(id, name);
  return (
    match<BlockName, DownloadSource | undefined>(
      fileTypeToResolvedBlockName(fileType)
    )
      .with(
        'image',
        'video',
        'code',
        'unknown',
        'pptx',
        'psd',
        'ai',
        'fig',
        () => storedDocumentDownloadSource(id)
      )
      // Markdown, canvas and spreadsheet content lives in the sync service and
      // exports from the open editor; a PDF's download bakes in the markup and
      // comments its open viewer has loaded.
      .with('md', 'canvas', 'spreadsheet', 'pdf', () => undefined)
      .with(
        'write',
        'call',
        'calendar',
        'chat',
        'database',
        'form',
        'channel',
        'project',
        'email',
        'contact',
        'company',
        'routine',
        'pr',
        'agent',
        'initiative',
        'pipeline',
        () => undefined
      )
      .exhaustive()
  );
}

/**
 * Downloads under a root of its own. The controller cancels its transfer when
 * its owner is disposed, and choosing the item disposes the menu it sits in.
 */
async function downloadDocument(source: DownloadSource) {
  await createRoot(async (dispose) => {
    try {
      await createFileDownload(() => source).start();
    } finally {
      dispose();
    }
  });
}

/**
 * Downloads one document row by id through the shared file download
 * controller (native save picker, toasts, `file.download` trace), under the
 * filename the file's own Download uses. Offer it for a single entity.
 */
export const makeDownloadAction = () => {
  const canExecute = (entity: EntityData): boolean =>
    documentDownloadSource(entity) !== undefined;

  /** Resolves once the file is handed off or its failure is reported. */
  const execute = async (entities: EntityData[]) => {
    const [entity] = entities;
    if (!entity || entities.length !== 1) return;
    const source = documentDownloadSource(entity);
    if (!source) return;
    await downloadDocument(source);
  };

  const executeWithSoup = async (
    entities: EntityData[],
    _soup: EntityActionListState
  ) => {
    // Return at once so the menu or drawer closes while the file loads; the
    // selection and focus stay as they were.
    fireAndForget(execute(entities), 'soup-entity-download');
  };

  return { canExecute, execute, executeWithSoup };
};
