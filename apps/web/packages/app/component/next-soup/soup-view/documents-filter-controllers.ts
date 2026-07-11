import type { SplitId } from '@app/component/split-layout/layoutManager';

type DocumentsFilterController = {
  toggleMarkdownFilter: () => void;
};

const registry = new Map<SplitId, DocumentsFilterController>();

export function registerDocumentsFilterSplit(
  splitId: SplitId,
  controller: DocumentsFilterController
): () => void {
  registry.set(splitId, controller);
  return () => {
    if (registry.get(splitId) === controller) registry.delete(splitId);
  };
}

export function getDocumentsFilterSplit(
  splitId: SplitId
): DocumentsFilterController | undefined {
  return registry.get(splitId);
}
