import { createSearchParams } from '@app/lib/split-router';
import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { enableCrm, isFeatureEnabled } from '@core/constant/featureFlags';
import { useLocation } from '@solidjs/router';
import { createEffect, createMemo, lazy, on, untrack } from 'solid-js';
import type { CrmRouteSearch } from './context/workspace-context';
import { pipelineIdOfTab, pipelineTab } from './core/navigation';
import { crmSearch, crmViewPipelineId } from './crm-route';
import {
  CRM_VIEW_URL_PARAM,
  decodeCrmViewParam,
} from './queries/saved-view-codec';

const Crm = lazy(async () => ({
  default: (await import('./crm')).Crm,
}));

export const CompaniesRouteView = withAuth(() => {
  if (!isFeatureEnabled(enableCrm))
    return <RedirectSplit to={{ type: 'component', id: 'home' }} />;
  usePageViewTracking('companies');
  const [search, setSearch] = createSearchParams(crmSearch);
  const pipelineRequest = () =>
    search.pipeline
      ? { pipelineId: search.pipeline, seek: search.seek }
      : undefined;
  const requested = untrack(pipelineRequest);
  const crmView = new URLSearchParams(window.location.search).get(
    CRM_VIEW_URL_PARAM
  );
  const location = useLocation();
  const linkedPipelineId = createMemo(() =>
    crmViewPipelineId(new URLSearchParams(location.search))
  );
  // A shared pipeline link followed while Customers is already open.
  createEffect(
    on(
      linkedPipelineId,
      (pipelineId) => {
        if (!pipelineId) return;
        setSearch(
          {
            tab: pipelineTab(pipelineId),
            pipeline: pipelineId,
            seek: crypto.randomUUID(),
          },
          { mode: 'merge', history: 'replace' }
        );
      },
      { defer: true }
    )
  );
  const routeSearch: CrmRouteSearch = {
    tab: () => search.tab,
    setTab: (
      tab: string,
      options?: { replace?: boolean; clearPipelineRequest?: boolean }
    ) => {
      const nextTab = tab || 'active';
      const clearRequest =
        options?.clearPipelineRequest ||
        (untrack(() => search.pipeline) !== '' &&
          pipelineIdOfTab(nextTab) !== untrack(() => search.pipeline));
      setSearch(
        clearRequest
          ? { tab: nextTab, pipeline: '', seek: '' }
          : { tab: nextTab },
        {
          mode: 'merge',
          history: options?.replace ? 'replace' : 'push',
        }
      );
    },
  };
  return (
    <Crm
      initialView={
        requested
          ? { kind: 'crm', activeTab: pipelineTab(requested.pipelineId) }
          : crmView
            ? decodeCrmViewParam(crmView)
            : undefined
      }
      pipelineRequest={{
        current: pipelineRequest,
        release: () =>
          setSearch(
            { pipeline: '', seek: '' },
            { mode: 'merge', history: 'replace' }
          ),
      }}
      routeSearch={routeSearch}
    />
  );
});
