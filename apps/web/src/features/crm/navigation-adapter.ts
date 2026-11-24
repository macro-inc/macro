import { useOptionalSplitRouter } from '@app/lib/split-router';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { paneOf } from '@components/app/split-layout/layoutManager';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { buildSimpleEntityUrl } from '@core/util/url';
import { getWebOrigin } from '@core/util/webOrigin';
import { openEntityInSplitFromUnifiedList } from '../next-soup/utils';
import type { CrmContext } from './context/crm-context';
import type { CrmViewConfig } from './core/saved-view';
import { crmRecordClaim } from './crm-route';
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

export async function copyCrmViewLink(
  config: CrmViewConfig,
  options: { silent?: boolean } = {}
) {
  return copyCrmLink(buildCrmViewShareUrl(config), options);
}
/** A pipeline's link opens Customers on it. */
export async function copyCrmPipelineLink(pipelineId: string) {
  await copyCrmLink(
    new URL(
      `/app/companies/pipeline/${encodeURIComponent(pipelineId)}`,
      getWebOrigin()
    ).toString()
  );
}
async function copyCrmLink(url: string, options: { silent?: boolean } = {}) {
  try {
    await navigator.clipboard.writeText(url);
    if (!options.silent) toast.success('Link copied to clipboard');
    return true;
  } catch {
    toast.failure('Failed to copy link');
    return false;
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
  const panel = useSplitPanel();
  const router = useOptionalSplitRouter();
  return {
    splitId: panel?.handle.id,
    showsElsewhere: (target) => {
      const claim = crmRecordClaim({
        recordType: target.type,
        recordId: target.id,
      });
      const split = panel?.handle.id;
      return (
        router?.claims.holderOf(
          `${claim.namespace}:${claim.id}`,
          split ? paneOf(split) : undefined
        ) !== undefined
      );
    },
    openWithSplit: (target, options) => {
      layout.openWithSplit(target, options);
    },
    showCompanies: () => {
      layout.replaceOrInsertSplit({ type: 'component', id: 'companies' });
    },
    openEntity: (entity, options) => {
      fireAndForget(
        openEntityInSplitFromUnifiedList(entity, {
          openInNewSplit: options?.newSplit,
          splitHandle: panel?.handle,
        }),
        'open-entity-in-split'
      );
    },
  };
}
