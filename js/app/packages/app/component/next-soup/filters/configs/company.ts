import {
  companyOwnedByUsersFilter,
  companyStageFilter as companyStagePredicate,
} from '../predicates';
import { config } from './base';

// Companies are fetched via the dedicated CRM soup request (capped at 500
// per team) rather than the dynamic filter AST, which has no property
// support for the `ccf` target — so stage/owner filters are client-side
// predicates with a no-op server query.

/**
 * Stage filter for the Customers view, driven by the view's stage
 * selection (`ctx.stages`, option ids from the team's active deal-stage
 * set plus the `NO_STAGE` sentinel). Mirrors `companyOwnerFilter`.
 */
export const companyStageFilter = config({
  id: 'company-stage',
  predicate: (e, ctx) =>
    companyStagePredicate(() => ctx.stages, ctx.resolveCompanyStage)(e),
  query: {},
});

export const companyOwnerFilter = config({
  id: 'company-owner',
  predicate: (e, ctx) => companyOwnedByUsersFilter(() => ctx.owners)(e),
  query: {},
});
