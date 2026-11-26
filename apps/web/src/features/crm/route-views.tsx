import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import {
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { useViewRestoration } from '@components/app/split-layout/view-restoration';
import { useLocation } from '@solidjs/router';
import { createEffect, createMemo, on } from 'solid-js';
import { pipelineTab } from './core/navigation';
import { Crm } from './crm';
import { crmViewPipelineId } from './crm-route';
import {
  CRM_VIEW_URL_PARAM,
  decodeCrmViewParam,
} from './queries/saved-view-codec';
import { createCrmRoute } from './route-adapter';

export const CompaniesRouteView = withAuth(() => {
  useViewRestoration();
  usePageViewTracking('companies');
  const panel = useSplitPanel();
  const route = createCrmRoute(panel?.handle);
  const crmView = new URLSearchParams(window.location.search).get(
    CRM_VIEW_URL_PARAM
  );
  const location = useLocation();
  const linkedPipelineId = createMemo(() =>
    crmViewPipelineId(new URLSearchParams(location.search))
  );
  // An older shared pipeline link followed while Customers is open leaves the
  // pane's own location unchanged, so the router has nothing to redirect.
  createEffect(
    on(
      linkedPipelineId,
      (pipelineId) => {
        if (pipelineId)
          route.setTab(pipelineTab(pipelineId), { replace: true });
      },
      { defer: true }
    )
  );
  return (
    <Crm
      initialView={crmView ? decodeCrmViewParam(crmView) : undefined}
      route={route}
    />
  );
});
