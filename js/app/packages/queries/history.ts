import { syncServiceClient, type HistoryVersionId } from '@service-sync/client';
import { keepPreviousData, useQuery } from '@tanstack/solid-query';
import { LoroDoc } from 'loro-crdt';
import type { SerializedEditorState } from 'lexical';
import type { Accessor } from 'solid-js';

export type HistoryStateResult = {
  state: SerializedEditorState;
  versionId: HistoryVersionId | null;
};

export function useHistoryStateQuery(documentId: Accessor<string>, tMs: Accessor<number | undefined>) {
  return useQuery<HistoryStateResult | null>(() => ({
    queryKey: ['history-state', documentId(), tMs()],
    queryFn: async () => {
      const t = tMs();
      if (t === undefined) return null;
      const maybe = await syncServiceClient.getStateAt({ documentId: documentId(), tMs: t });
      if (maybe.isErr()) throw new Error(maybe.error);
      const doc = new LoroDoc();
      doc.import(maybe.value.bytes);
      return {
        state: doc.toJSON() as SerializedEditorState,
        versionId: maybe.value.versionId,
      };
    },
    enabled: tMs() !== undefined,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  }));
}
