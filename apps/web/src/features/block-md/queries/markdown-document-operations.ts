import { throwOnErr } from '@core/util/result';
import { utf8Encode } from '@core/util/string';
import { refetchHistory } from '@queries/history/history';
import { storageServiceClient } from '@service-storage/client';
import type { HistoryVersionId } from '@service-sync/client';
import { useMutation } from '@tanstack/solid-query';

export function createForkMarkdownDocumentMutation() {
  return useMutation(() => ({
    mutationFn: (params: {
      documentId: string;
      documentName: string;
      syncServiceVersion?: HistoryVersionId;
    }) =>
      throwOnErr(async () => await storageServiceClient.copyDocument(params)),
  }));
}

export async function loadMarkdownCachedSnapshot(
  documentId: string
): Promise<Uint8Array | undefined> {
  const result = await storageServiceClient.fetchCachedSnapshot(documentId);
  return result.isOk() ? result.value : undefined;
}

async function saveMarkdownDocument(
  documentId: string,
  text: string
): Promise<void> {
  const result = await storageServiceClient.simpleSave({
    documentId,
    file: new Blob([utf8Encode(text)], { type: 'text/markdown' }),
  });
  if (result.isErr()) {
    console.error('error on markdown save');
    throw new Error('Unable to save markdown document');
  }
  await refetchHistory();
}

export function createSaveMarkdownDocumentMutation() {
  return useMutation(() => ({
    mutationFn: ({ documentId, text }: { documentId: string; text: string }) =>
      saveMarkdownDocument(documentId, text),
  }));
}
