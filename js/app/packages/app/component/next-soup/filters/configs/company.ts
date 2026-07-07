import { PROPERTY_OPTION_IDS } from '@property/constants';
import {
  companyOwnedByUsersFilter,
  hasCompanyStage,
  hasNoCompanyStage,
} from '../predicates';
import { config, type Predicate } from './base';

// Companies are fetched via the dedicated CRM soup request (capped at 500
// per team) rather than the dynamic filter AST, which has no property
// support for the `ccf` target — so stage/owner filters are client-side
// predicates with a no-op server query.
const stageFilter = <TId extends string>(id: TId, predicate: Predicate) =>
  config({ id, predicate, query: {} });

export const COMPANY_STAGE_FILTERS = [
  stageFilter('company-stage-lead', (e) =>
    hasCompanyStage(e, PROPERTY_OPTION_IDS.STAGE.LEAD)
  ),
  stageFilter('company-stage-qualified', (e) =>
    hasCompanyStage(e, PROPERTY_OPTION_IDS.STAGE.QUALIFIED)
  ),
  stageFilter('company-stage-demo', (e) =>
    hasCompanyStage(e, PROPERTY_OPTION_IDS.STAGE.DEMO)
  ),
  stageFilter('company-stage-trial', (e) =>
    hasCompanyStage(e, PROPERTY_OPTION_IDS.STAGE.TRIAL)
  ),
  stageFilter('company-stage-negotiation', (e) =>
    hasCompanyStage(e, PROPERTY_OPTION_IDS.STAGE.NEGOTIATION)
  ),
  stageFilter('company-stage-customer', (e) =>
    hasCompanyStage(e, PROPERTY_OPTION_IDS.STAGE.CUSTOMER)
  ),
  stageFilter('company-stage-churned', (e) =>
    hasCompanyStage(e, PROPERTY_OPTION_IDS.STAGE.CHURNED)
  ),
  stageFilter('company-no-stage', hasNoCompanyStage),
] as const;

export const companyOwnerFilter = config({
  id: 'company-owner',
  predicate: (e, ctx) => companyOwnedByUsersFilter(() => ctx.owners)(e),
  query: {},
});
