import { type EntityData, getCompanyOwnerId } from '@entity';
import { getCompanyStageOptionId } from '@entity/utils/company-properties';
import { getPropertyOptionLabel } from '@entity/utils/task-properties';
import {
  config,
  NO_ASSIGNEE,
  NO_STAGE,
} from '../next-soup/filters/configs/base';
import { defineQueryFilters } from '../next-soup/filters/filter-store/compile';
import {
  matchesInteractionWindow,
  needsCompanyFollowUp,
} from './core/navigation';

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

export const companyNeedsFollowUpFilter = config({
  id: 'company-needs-follow-up',
  predicate: (entity, ctx) => {
    if (entity.type !== 'crm_company') return false;
    const stageId = ctx.resolveCompanyStage
      ? ctx.resolveCompanyStage(entity)
      : getCompanyStageOptionId(entity);
    const label = stageId
      ? (ctx.companyStageLabel ?? getPropertyOptionLabel)(stageId)
      : undefined;
    return needsCompanyFollowUp(entity.updatedAt, label);
  },
  query: {},
});

export const companyRecentlyActiveFilter = config({
  id: 'company-recently-active',
  predicate: (entity) =>
    entity.type === 'crm_company' &&
    matchesInteractionWindow(entity.updatedAt, 'recently-active'),
  query: {},
});

/**
 * Stage filter for companies, driven by the view's stage selection
 * (`ctx.stages`). `NO_STAGE` matches companies without a Stage set. Stage
 * resolution goes through `resolveStage` (the team's active deal-stage
 * set, from `ctx.resolveCompanyStage`) when supplied, so the filter
 * buckets companies exactly like the kanban — legacy system-stage values
 * included; otherwise it falls back to the raw system Stage value.
 */
function companyStagePredicate(
  stageIds: () => string[] | undefined,
  resolveStage?: (entity: EntityData) => string | undefined
) {
  return (entity: EntityData): boolean => {
    const stages = stageIds();
    if (!stages?.length) return true;
    if (entity.type !== 'crm_company') return false;
    const stageId = resolveStage
      ? resolveStage(entity)
      : getCompanyStageOptionId(entity);
    return stages.some((id) =>
      id === NO_STAGE ? stageId === undefined : stageId === id
    );
  };
}

/**
 * Owner filter for companies, driven by the view's owner selection
 * (`ctx.owners`). `NO_OWNER` matches companies without an Owner set.
 */
function companyOwnedByUsersFilter(ownerIds: () => string[] | undefined) {
  return (entity: EntityData): boolean => {
    const owners = ownerIds();
    if (!owners?.length) return true;
    if (entity.type !== 'crm_company') return false;
    const ownerId = getCompanyOwnerId(entity);
    return owners.some((id) =>
      id === NO_ASSIGNEE ? ownerId === undefined : ownerId === id
    );
  };
}

function crmCompanyPredicate(entity: EntityData): boolean {
  return entity.type === 'crm_company';
}
function crmCompanyActivePredicate(entity: EntityData): boolean {
  return entity.type === 'crm_company' && !entity.hidden;
}
function crmCompanyHiddenPredicate(entity: EntityData): boolean {
  return entity.type === 'crm_company' && entity.hidden;
}
function crmContactActivePredicate(entity: EntityData): boolean {
  return entity.type === 'crm_contact' && !entity.hidden;
}

export const crmCompanyFilter = config({
  id: 'crm-company',
  predicate: crmCompanyPredicate,
  query: defineQueryFilters({}, { skipTargets: ['ccf'] }),
});
export const crmCompanyActiveFilter = config({
  id: 'crm-company-active',
  predicate: crmCompanyActivePredicate,
  query: defineQueryFilters(
    { include: { crmCompanyHidden: false } },
    { skipTargets: ['ccf'] }
  ),
});
export const crmCompanyHiddenFilter = config({
  id: 'crm-company-hidden',
  predicate: crmCompanyHiddenPredicate,
  query: defineQueryFilters(
    { include: { crmCompanyHidden: true } },
    { skipTargets: ['ccf'] }
  ),
});
export const crmContactActiveFilter = config({
  id: 'crm-contact-active',
  predicate: crmContactActivePredicate,
  query: defineQueryFilters(
    { include: { crmContactHidden: false } },
    { skipTargets: ['crmf'] }
  ),
});
