import { defineRoute } from '@app/lib/split-router';
import {
  CRM_VIEW_URL_PARAM,
  decodeCrmViewParam,
} from '@companies/crm/saved-views';
import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { enableCrm, isFeatureEnabled } from '@core/constant/featureFlags';
import { lazy } from 'solid-js';
import { getViewPreset } from '../next-soup/sidebar/soup-filter-presets';

const SoupView = lazy(async () => ({
  default: (await import('../next-soup/soup-view/soup-view')).SoupView,
}));

export const CompaniesRouteView = withAuth(() => {
  if (!isFeatureEnabled(enableCrm))
    return <RedirectSplit to={{ type: 'component', id: 'inbox' }} />;
  usePageViewTracking('companies');
  const preset = getViewPreset('companies');
  const crmView = new URLSearchParams(window.location.search).get(
    CRM_VIEW_URL_PARAM
  );
  return (
    <SoupView
      viewName="Customers"
      initialFilters={preset?.filters}
      initialClientFilters={preset?.clientFilters}
      initialGroupBy={preset?.groupBy}
      initialCrmView={crmView ? decodeCrmViewParam(crmView) : undefined}
    />
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
