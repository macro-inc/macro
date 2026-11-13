import { fireAndForget } from '@core/util/fireAndForget';
import type { ResultAsync } from 'neverthrow';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import type { DocumentError, PdfDocument } from '../context/contracts-context';

/**
 * The opened PDFs of a set of documents, by document id. A document appears
 * once it has loaded; one that fails to load is listed in `failed` until it
 * is retried.
 */
export function createPacketPdfs(
  open: (documentId: string) => ResultAsync<PdfDocument, DocumentError>,
  documentIds: Accessor<readonly string[]>
) {
  const [pdfs, setPdfs] = createSignal<Record<string, PdfDocument>>({});
  const [failed, setFailed] = createSignal<readonly string[]>([]);
  const loading: string[] = [];
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  async function load(documentId: string) {
    if (loading.includes(documentId)) return;
    loading.push(documentId);
    const result = await open(documentId);
    loading.splice(loading.indexOf(documentId), 1);
    if (disposed) return;

    if (result.isErr()) {
      setFailed((ids) => [...ids, documentId]);
      return;
    }
    setPdfs((loaded) => ({ ...loaded, [documentId]: result.value }));
  }

  createEffect(
    on(documentIds, (ids) => {
      for (const documentId of ids) {
        if (pdfs()[documentId] || failed().includes(documentId)) continue;
        fireAndForget(load(documentId), 'contracts.packet-pdfs');
      }
    })
  );

  return {
    pdf: (documentId: string): PdfDocument | undefined => pdfs()[documentId],
    failed,
    /** Every document is open: the whole packet can be read. */
    allOpen: () => documentIds().every((documentId) => pdfs()[documentId]),
    /** Try a document that failed to load again. */
    retry(documentId: string) {
      setFailed((ids) => ids.filter((id) => id !== documentId));
      fireAndForget(load(documentId), 'contracts.packet-pdfs');
    },
  };
}
