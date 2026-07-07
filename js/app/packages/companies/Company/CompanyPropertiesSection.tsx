import { EntityPropertiesSection } from '@app/component/side-panel/properties/EntityPropertiesSection';
import { buildCompanyDefaultProperties } from '@entity/extractors-property';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { useIsTeamAdmin } from '@queries/team/teams';

/** Fixed display order: builtin CRM defaults first, custom ones after. */
const COMPANY_PINNED_ORDER = [
  SYSTEM_PROPERTY_IDS.STAGE,
  SYSTEM_PROPERTY_IDS.COMPANY_OWNER,
  SYSTEM_PROPERTY_IDS.REVENUE,
] as const;

/**
 * CRM properties for a company (Stage / Owner / Revenue + custom),
 * mirroring the task side panel's properties section. The builtin
 * defaults render as editable placeholders even before the company has
 * any values saved. Editing follows CRM access: team admins/owners can
 * edit, members see read-only values.
 */
export function CompanyPropertiesSection(props: { companyId: string }) {
  const isTeamAdmin = useIsTeamAdmin();

  return (
    <EntityPropertiesSection
      entityId={props.companyId}
      entityType="COMPANY"
      canEdit={isTeamAdmin()}
      defaultProperties={buildCompanyDefaultProperties}
      pinnedPropertyDefinitionOrder={COMPANY_PINNED_ORDER}
    />
  );
}
