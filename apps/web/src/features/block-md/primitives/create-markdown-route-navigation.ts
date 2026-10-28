import { createSearchParams } from '@app/lib/split-router';
import { type Accessor, createEffect, on } from 'solid-js';
import { URL_PARAMS } from '../constants';
import { markdownDetailSearch } from '../markdown-route';

/** Deliver route requests to the editor's existing queued location handler. */
export function createMarkdownRouteNavigation(
  documentId: Accessor<string>,
  navigate: (params: Record<string, string>) => void
) {
  const [search] = createSearchParams(markdownDetailSearch);
  createEffect(
    on(
      () =>
        [search.nodeId, search.seek, search.documentId, documentId()] as const,
      ([nodeId]) => {
        if (
          nodeId &&
          (!search.documentId || search.documentId === documentId())
        )
          navigate({ [URL_PARAMS.nodeId]: nodeId });
      }
    )
  );
}
