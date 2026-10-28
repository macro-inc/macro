import {
  createSearchParamsCodec,
  type SerializedSearchParams,
  type SplitReference,
  type SplitSearchState,
} from '@app/lib/split-router';
import { uuidRouteReference } from '@components/app/split-layout/split-router/mention-links';
import { z } from 'zod';
import { pipelineIdOfTab } from './core/navigation';
import { COMPANY_SECTIONS, CONTACT_SECTIONS } from './core/record';
import {
  CRM_VIEW_URL_PARAM,
  decodeCrmViewParam,
} from './queries/saved-view-codec';

/** Customers pane search. `tab` is the open list; a pipeline is its own route. */
export const crmSearch = {
  namespace: 'crm',
  schema: z.object({ tab: z.string() }),
  defaults: { tab: 'active' },
};

export type CrmSearchParams = z.infer<typeof crmSearch.schema>;

export const crmSearchCodec = createSearchParamsCodec(crmSearch);

/** The Customers pane search of the People list, where contacts open from. */
export const crmPeopleSearch: SplitSearchState = {
  [crmSearch.namespace]: { tab: ['people'] },
};

/** The Discussion message an open record shows; a new `seek` repeats a request. */
export const crmRecordSearch = {
  namespace: 'crm-record',
  schema: z.object({ commentId: z.string(), seek: z.string() }),
  defaults: { commentId: '', seek: '' },
};

export const crmPipelineParams = z.object({ pipelineId: z.string().min(1) });

/** A company or contact opened inside Customers; no section is its Overview. */
export const crmRecordParams = z.object({
  recordType: z.enum(['company', 'contact']),
  recordId: z.string().min(1),
  section: z
    .enum([...new Set([...COMPANY_SECTIONS, ...CONTACT_SECTIONS])])
    .optional(),
});

export type CrmRecordParams = z.infer<typeof crmRecordParams>;

/** Records opened on the way to the shown one, kept with its history entry. */
export const crmRecordTrailSchema = z
  .array(
    z.object({
      type: z.enum(['company', 'contact']),
      id: z.string().min(1),
      name: z.string(),
    })
  )
  .min(1);

export function crmRecordClaim({ recordType, recordId }: CrmRecordParams) {
  return { namespace: 'block', id: `${recordType}:${recordId}` };
}

export function crmRecordReference({
  recordType,
  recordId,
}: CrmRecordParams): SplitReference | undefined {
  return uuidRouteReference(recordId, recordType);
}

/** A pipeline link references the pipeline, not a place within it. */
export function crmPipelineReference(
  pipelineId: string
): SplitReference | undefined {
  const reference = uuidRouteReference(pipelineId, 'pipeline');
  return reference && { ...reference, params: {} };
}

function crmTabFromQuery(query: URLSearchParams): string | undefined {
  const view = query.get(CRM_VIEW_URL_PARAM);
  if (view) return decodeCrmViewParam(view)?.activeTab;
  for (const [key, value] of query) {
    if (key === 'crm.tab' || key.endsWith('.crm.tab')) return value;
  }
  return undefined;
}

/** A Customers list link that shows a pipeline references the pipeline. */
export function crmViewReference(
  query: URLSearchParams
): SplitReference | undefined {
  const id = pipelineIdOfTab(crmTabFromQuery(query));
  return id ? crmPipelineReference(id) : undefined;
}

/** The pipeline a shared `crmView` link shows, if any. */
export function crmViewPipelineId(query: URLSearchParams): string | undefined {
  const view = query.get(CRM_VIEW_URL_PARAM);
  return view
    ? pipelineIdOfTab(decodeCrmViewParam(view)?.activeTab)
    : undefined;
}

/**
 * The pipeline a Customers list URL from before pipelines had their own route
 * shows: its tab, its one-time pipeline request, or a shared view's tab.
 */
export function legacyCrmPipelineId(
  search: SplitSearchState | undefined,
  externalSearch: string | undefined
): string | undefined {
  const crm: SerializedSearchParams | undefined = search?.[crmSearch.namespace];
  return (
    pipelineIdOfTab(crm?.tab?.at(-1)) ??
    crm?.pipeline?.at(-1) ??
    crmViewPipelineId(new URLSearchParams(externalSearch))
  );
}
