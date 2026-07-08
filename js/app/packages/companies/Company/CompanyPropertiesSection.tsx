import { EntityPropertiesSection } from '@app/component/side-panel/properties/EntityPropertiesSection';
import { useDealStages } from '@companies/crm/deal-stages';
import { buildCompanyDefaultProperties } from '@entity/extractors-property';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { useIsTeamAdmin } from '@queries/team/teams';

/**
 * CRM properties for a company (Stage / Owner / Revenue + custom),
 * mirroring the task side panel's properties section. The builtin
 * defaults render as editable placeholders even before the company has
 * any values saved. Editing follows CRM access: team admins/owners can
 * edit, members see read-only values.
 *
 * Stage goes through the team's active deal-stage set: when the team has
 * customized stages, the panel edits the team Stage definition and the
 * fetched system Stage row is hidden.
 */
export function CompanyPropertiesSection(props: { companyId: string }) {
  const isTeamAdmin = useIsTeamAdmin();
  const dealStages = useDealStages();

  // Builtin CRM defaults, with the Stage stub swapped for the active
  // stage definition (the team's own when customized).
  const defaultProperties = () =>
    buildCompanyDefaultProperties().map((property) =>
      property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.STAGE
        ? dealStages.stageProperty()
        : property
    );

  /** Fixed display order: builtin CRM defaults first, custom ones after. */
  const pinnedOrder = () => [
    dealStages.stageDefinitionId(),
    SYSTEM_PROPERTY_IDS.COMPANY_OWNER,
    SYSTEM_PROPERTY_IDS.REVENUE,
  ];

  return (
    <EntityPropertiesSection
      entityId={props.companyId}
      entityType="COMPANY"
      canEdit={isTeamAdmin()}
      defaultProperties={defaultProperties}
      pinnedPropertyDefinitionOrder={pinnedOrder()}
      hidePropertyDefinitionIds={
        dealStages.isCustomized() ? [SYSTEM_PROPERTY_IDS.STAGE] : undefined
      }
    />
  );
}
