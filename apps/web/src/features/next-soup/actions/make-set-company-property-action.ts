import { openPropertyEditor } from '@app/features/property/editor/state/propertyEditor';
import { useDealStages } from '@companies/crm/deal-stages';
import type { EntityData } from '@entity';
import { buildCompanyDefaultProperties } from '@entity/extractors-property';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import type { Property } from '@property/types';

/** Builtin CRM company fields settable from entity action menus. */
export type CompanyCrmField = 'stage' | 'owner' | 'revenue';

/**
 * "Set stage / owner / revenue" for CRM company rows: opens the global
 * property editor (the same one task status/priority/assignee commands
 * use) targeting the builtin CRM property, editing the whole selection.
 * Available to all team members; the backend enforces write access on
 * property saves.
 */
export const makeSetCompanyPropertyAction = () => {
  const dealStages = useDealStages();

  const canExecute = (entity: EntityData, field: CompanyCrmField): boolean =>
    entity.type === 'crm_company' &&
    (field !== 'stage' || !dealStages.isLoading());

  const propertyFor = (field: CompanyCrmField): Property | undefined => {
    // Stage resolves through the active deal-stage set (the team's own
    // definition when customized) so edits write to the active definition.
    if (field === 'stage') return dealStages.stageProperty();
    const definitionId =
      field === 'owner'
        ? SYSTEM_PROPERTY_IDS.COMPANY_OWNER
        : SYSTEM_PROPERTY_IDS.REVENUE;
    return buildCompanyDefaultProperties().find(
      (property) => property.propertyDefinitionId === definitionId
    );
  };

  const execute = (entities: EntityData[], field: CompanyCrmField) => {
    // Stages are lazy: don't open an editor against system defaults before
    // the team's active definition has resolved.
    if (field === 'stage' && dealStages.isLoading()) return;
    const property = propertyFor(field);
    if (property) openPropertyEditor(entities, 'direct', property);
  };

  return { canExecute, execute };
};
