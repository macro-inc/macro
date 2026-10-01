import { defineRoute } from '@app/lib/split-router';
import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { enableCrm, isFeatureEnabled } from '@core/constant/featureFlags';
import { lazy } from 'solid-js';
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
  const crmView = new URLSearchParams(window.location.search).get(
    CRM_VIEW_URL_PARAM
  );
  return (
    <Crm initialView={crmView ? decodeCrmViewParam(crmView) : undefined} />
  );
});

export const companiesRoute = defineRoute({
  id: 'view-companies',
  path: 'companies',
  component: CompaniesRouteView,
  search: '*' as const,
  externalSearch: ['crmView'],
  claim: () => ({ namespace: 'component', id: 'companies' }),
});
