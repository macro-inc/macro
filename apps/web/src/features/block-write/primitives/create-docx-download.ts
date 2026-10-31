import { downloadFile } from '@filesystem/download';
import { downloadExportedDocument } from '@service-storage/util/downloadExportedDocument';
import { createSignal } from 'solid-js';
import type { DocxEditor } from './create-docx-editor';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Saving a Word document as a `.docx` from the file menu. The mounted editor
 * saves its live state, unsynced edits included; before it mounts, the server's
 * export is the latest copy.
 */
export function createDocxDownload(options: {
  documentId: string;
  fileName: () => string;
  onError: (error: unknown) => void;
}) {
  const [editor, setEditor] = createSignal<DocxEditor>();

  const save = (bytes: Uint8Array) =>
    downloadFile(
      new Blob([bytes.slice().buffer], { type: DOCX_MIME }),
      options.fileName()
    );

  const download = async () => {
    const current = editor();
    try {
      if (current) {
        await current.idle();
        await save(await current.save());
      } else {
        await save(
          await downloadExportedDocument({ documentId: options.documentId })
        );
      }
    } catch (error) {
      options.onError(error);
    }
  };

  return { setEditor, save, download };
}
