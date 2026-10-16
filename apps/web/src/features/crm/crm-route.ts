import {
  createSearchParamsCodec,
  type SplitReference,
  type SplitSearchState,
} from '@app/lib/split-router';
import { uuidRouteReference } from '@components/app/split-layout/split-router/mention-links';
import { z } from 'zod';
import { pipelineIdOfTab, pipelineTab } from './core/navigation';
import {
  CRM_VIEW_URL_PARAM,
  decodeCrmViewParam,
} from './queries/saved-view-codec';

/** Customers pane search. `tab` is the open view. A new `seek` repeats a pipeline request. */
export const crmSearch = {
  namespace: 'crm',
  schema: z.object({
    tab: z.string(),
    pipeline: z.string(),
    seek: z.string(),
  }),
  defaults: { tab: 'active', pipeline: '', seek: '' },
};

export type CrmSearchParams = z.infer<typeof crmSearch.schema>;

export const crmSearchCodec = createSearchParamsCodec(crmSearch);

/** The Customers pane search that opens it on `pipelineId`. */
export function crmPipelineSearch(pipelineId: string): SplitSearchState {
  return {
    [crmSearch.namespace]:
      crmSearchCodec.serialize({
        tab: pipelineTab(pipelineId),
        pipeline: pipelineId,
        seek: crypto.randomUUID(),
      }) ?? {},
  };
}

function crmTabFromQuery(query: URLSearchParams): string | undefined {
  const view = query.get(CRM_VIEW_URL_PARAM);
  if (view) return decodeCrmViewParam(view)?.activeTab;
  for (const [key, value] of query) {
    if (key === 'crm.tab' || key.endsWith('.crm.tab')) return value;
  }
  return undefined;
}

/** A shared Customers link that shows a pipeline references the pipeline. */
export function crmViewReference(
  query: URLSearchParams
): SplitReference | undefined {
  const reference = uuidRouteReference(
    pipelineIdOfTab(crmTabFromQuery(query)),
    'pipeline'
  );
  // The rest of the shared view state is no place within the pipeline.
  return reference && { ...reference, params: {} };
}
