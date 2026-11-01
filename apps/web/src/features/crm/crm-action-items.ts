import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { enableSequences } from '@core/constant/featureFlags';
import type { EntityData } from '@entity';
import type { EntityActionListState } from '../next-soup/actions/entity-action-context';
import {
  canAddToSequence,
  openAddToSequence,
} from '../sequences/add-to-sequence';
import { makeSetCompanyPropertyAction } from './crm-actions';
import { makeHideCompanyAction } from './crm-hide-action';
import { useSetCompanyHiddenMutation } from './record-adapter';

type CrmEntityActionItem = {
  id: string;
  label: string;
  onClick: () => void | Promise<void>;
};
/** CRM actions contributed to shared entity menus. */
export function createCrmEntityActionItems() {
  const hiddenMutation = useSetCompanyHiddenMutation();
  const hideCompanyAction = makeHideCompanyAction({
    setHidden: (companyId, hidden) =>
      hiddenMutation.mutateAsync({ companyId, hidden }),
  });
  const setCompanyPropertyAction = makeSetCompanyPropertyAction();
  const sequencesFlag = useFeatureFlag(enableSequences);

  return (
    entities: EntityData[],
    soup: EntityActionListState
  ): CrmEntityActionItem[] => {
    const canExecuteAll = (canExecute: (entity: EntityData) => boolean) =>
      entities.length > 0 && entities.every(canExecute);
    // CRM group: Set stage/owner/revenue on the whole company
    // selection, Add to sequence for People, Hide / Unhide for a single company.
    const crmItems: CrmEntityActionItem[] = [];

    for (const [field, label] of [
      ['stage', 'Set stage'],
      ['owner', 'Set owner'],
      ['revenue', 'Set revenue'],
    ] as const) {
      if (
        !canExecuteAll((entity) =>
          setCompanyPropertyAction.canExecute(entity, field)
        )
      )
        continue;
      crmItems.push({
        id: `set-${field}`,
        label,
        onClick: () => setCompanyPropertyAction.execute(entities, field),
      });
    }

    if (sequencesFlag().enabled && canAddToSequence(entities)) {
      crmItems.push({
        id: 'add-to-sequence',
        label: t('sequences.addToSequence'),
        onClick: () => openAddToSequence(entities),
      });
    }

    const singleEntity = entities.length === 1 ? entities[0] : undefined;
    if (
      singleEntity?.type === 'crm_company' &&
      hideCompanyAction.canExecute(singleEntity)
    ) {
      crmItems.push({
        id: 'hide-company',
        label: singleEntity.hidden ? 'Unhide' : 'Hide',
        onClick: () => hideCompanyAction.executeWithSoup(entities, soup),
      });
    }

    return crmItems;
  };
}
