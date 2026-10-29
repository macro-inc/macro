import { paneRoute } from '@app/routes/app-route';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import { crmPeopleSearch, crmRecordSearch } from './crm-route';

/** Customers showing `pipelineId`, without mounting a legacy pipeline block. */
export function crmPipelineContent(pipelineId: string): SplitContent {
  return {
    type: 'component',
    id: 'companies',
    entryMetadata: {
      route: paneRoute(
        { id: 'view-companies', params: {} },
        { id: 'companies-pipeline', params: { pipelineId } }
      ),
    },
  };
}

/** Customers showing a record, scrolled to `commentId` in its Discussion. */
export function crmRecordContent(
  record: { type: 'company' | 'contact'; id: string },
  commentId?: string
): SplitContent {
  return {
    type: 'component',
    id: 'companies',
    entryMetadata: {
      route: paneRoute(
        { id: 'view-companies', params: {} },
        {
          id: 'companies-record',
          params: { recordType: record.type, recordId: record.id },
        }
      ),
      search: {
        ...(record.type === 'contact' ? crmPeopleSearch : {}),
        ...(commentId
          ? {
              [crmRecordSearch.namespace]: {
                commentId: [commentId],
                seek: [crypto.randomUUID()],
              },
            }
          : {}),
      },
    },
  };
}
