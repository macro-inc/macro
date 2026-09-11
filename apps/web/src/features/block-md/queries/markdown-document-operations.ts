import { utf8Encode } from '@core/util/string';
import { refetchHistory } from '@queries/history/history';
import { storageServiceClient } from '@service-storage/client';

export async function loadMarkdownCachedSnapshot(
  documentId: string
): Promise<Uint8Array | undefined> {
  const result = await storageServiceClient.fetchCachedSnapshot(documentId);
  return result.isOk() ? result.value : undefined;
}

export async function saveMarkdownDocument(
  documentId: string,
  text: string
): Promise<void> {
  const result = await storageServiceClient.simpleSave({
    documentId,
    file: new Blob([utf8Encode(text)], { type: 'text/markdown' }),
  });
  if (result.isErr()) {
    console.error('error on markdown save');
    return;
  }
  await refetchHistory();
}
