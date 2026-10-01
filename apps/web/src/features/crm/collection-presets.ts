import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { defineQueryFilters } from '../next-soup/filters/filter-store';
import type { ViewTabConfig } from '../next-soup/sidebar/soup-filter-presets';
export const CRM_TAB_PRESETS: ViewTabConfig = {
  default: 'active',
  tabs: {
    active: () => ({
      filters: defineQueryFilters(
        { include: { crmCompanyHidden: false } },
        { skipTargets: ['ccf'] }
      ),
      clientFilters: { and: ['crm-company-active'] },
      groupBy: `property:${SYSTEM_PROPERTY_IDS.STAGE}`,
    }),
    // Admin/owner only — the BE rejects `hidden: true` requests from
    // non-admins with 403. Returning `undefined` hides the tab for
    // non-admins via the same pattern context-required views use.
    hidden: (ctx) => {
      if (!ctx.isTeamAdmin) return undefined;
      return {
        filters: defineQueryFilters(
          { include: { crmCompanyHidden: true } },
          { skipTargets: ['ccf'] }
        ),
        clientFilters: { and: ['crm-company-hidden'] },
        groupBy: `property:${SYSTEM_PROPERTY_IDS.STAGE}`,
      };
    },
  },
};
