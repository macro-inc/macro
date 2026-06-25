import {
  type HistorySession,
  type HistoryVersionId,
  syncServiceClient,
} from '@service-sync/client';
import { keepPreviousData, useQuery } from '@tanstack/solid-query';
import type { SerializedEditorState } from 'lexical';
import { LoroDoc } from 'loro-crdt';
import type { Accessor } from 'solid-js';

export type HistoryStateResult = {
  state: SerializedEditorState;
  versionId: HistoryVersionId | null;
};

export type HistoryMetaResult = {
  sessions: HistorySession[];
};

const historyKeys = {
  meta: (documentId: string) => ['history-meta', documentId] as const,
  state: (documentId: string, atUnixTimeMs: number | undefined) =>
    ['history-state', documentId, atUnixTimeMs] as const,
};

export function useHistoryMetaQuery(documentId: Accessor<string>) {
  return useQuery<HistoryMetaResult>(() => ({
    queryKey: historyKeys.meta(documentId()),
    queryFn: async () => {
      const maybe = await syncServiceClient.getHistoryMeta({
        documentId: documentId(),
      });
      if (maybe.isErr()) throw new Error(maybe.error);
      return maybe.value;
    },
    refetchInterval: 30_000,
  }));
}

export function useHistoryStateQuery(
  documentId: Accessor<string>,
  atUnixTimeMs: Accessor<number | undefined>
) {
  return useQuery<HistoryStateResult | null>(() => ({
    queryKey: historyKeys.state(documentId(), atUnixTimeMs()),
    queryFn: async () => {
      const unixTimeMs = atUnixTimeMs();
      if (unixTimeMs === undefined) return null;

      const maybeDoc = await syncServiceClient.getStateAt({
        documentId: documentId(),
        tMs: unixTimeMs,
      });

      if (maybeDoc.isErr()) throw new Error(maybeDoc.error);
      const doc = new LoroDoc();
      doc.import(maybeDoc.value.bytes);

      return {
        state: doc.toJSON() as SerializedEditorState,
        versionId: maybeDoc.value.versionId,
      };
    },
    enabled: atUnixTimeMs() !== undefined,
    // the document state at "x time in the past" never "expires"
    staleTime: Infinity,
    // keepPreviousData is just an identity function that returns the last data
    // that tanstack provides
    placeholderData: keepPreviousData,
  }));
}
