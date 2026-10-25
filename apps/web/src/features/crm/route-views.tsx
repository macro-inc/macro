import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { enableCrm, isFeatureEnabled } from '@core/constant/featureFlags';
import { useLocation } from '@solidjs/router';
import { createEffect, createMemo, lazy, on } from 'solid-js';
import { pipelineTab } from './core/navigation';
import { crmViewPipelineId } from './crm-route';
import {
  CRM_VIEW_URL_PARAM,
  decodeCrmViewParam,
} from './queries/saved-view-codec';
import { createCrmRoute } from './route-adapter';

const Crm = lazy(async () => ({
  default: (await import('./crm')).Crm,
}));

export const CompaniesRouteView = withAuth(() => {
  if (!isFeatureEnabled(enableCrm))
    return <RedirectSplit to={{ type: 'component', id: 'home' }} />;
  usePageViewTracking('companies');
  const route = createCrmRoute();
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
