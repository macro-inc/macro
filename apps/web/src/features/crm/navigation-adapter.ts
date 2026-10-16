import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import { buildSimpleEntityUrl } from '@core/util/url';
import { getWebOrigin } from '@core/util/webOrigin';
import { openEntityInSplitFromUnifiedList } from '../next-soup/utils';
import type { CrmContext } from './context/crm-context';
import type { CrmViewConfig } from './core/saved-view';
import {
  CRM_VIEW_URL_PARAM,
  encodeCrmViewParam,
} from './queries/saved-view-codec';
/** Share link for a CRM view, including its selected pipeline. */
export function buildCrmViewShareUrl(config: CrmViewConfig): string {
  const url = new URL('/app/companies', getWebOrigin());
  url.searchParams.set(CRM_VIEW_URL_PARAM, encodeCrmViewParam(config));
  return url.toString();
}

export async function copyCrmViewLink(config: CrmViewConfig) {
  try {
    await navigator.clipboard.writeText(buildCrmViewShareUrl(config));
    toast.success('Link copied to clipboard');
  } catch {
    toast.failure('Failed to copy link');
  }
}
export async function copyCrmRecordLink(target: {
  type: 'company' | 'contact';
  id: string;
}) {
  try {
    await navigator.clipboard.writeText(buildSimpleEntityUrl(target));
    toast.success('Link copied to clipboard');
    return true;
  } catch {
    toast.failure('Could not copy link. Please try again.');
    return false;
  }
}
export function createAppCrmNavigation(): ReturnType<
  CrmContext['createNavigation']
> {
  const layout = useSplitLayout();
  return {
    splitId: useSplitPanel()?.handle.id,
    openWithSplit: (target, options) => {
      layout.openWithSplit(target, options);
    },
    showCompanies: () => {
      layout.replaceOrInsertSplit({ type: 'component', id: 'companies' });
    },
    openEntity: (entity) => {
      void openEntityInSplitFromUnifiedList(entity, {});
    },
  };
}
