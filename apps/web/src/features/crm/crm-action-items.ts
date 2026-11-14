import { t } from '@app/lib/i18n';
import type { EntityData } from '@entity';
import ArchiveIcon from '@icon/system/regular/archive.svg';
import ArrowCounterClockwiseIcon from '@icon/system/regular/arrow-counter-clockwise.svg';
import CurrencyDollarIcon from '@icon/system/regular/currency-dollar.svg';
import FlagIcon from '@icon/system/regular/flag.svg';
import UserIcon from '@icon/system/regular/user.svg';
import { useIsTeamAdmin } from '@queries/team/teams';
import type { Component, JSX } from 'solid-js';
import type { EntityActionListState } from '../next-soup/actions/entity-action-context';
import { makeSetCompanyPropertyAction } from './crm-actions';
import { makeHideCompanyAction } from './crm-hide-action';
import { useSetCompanyHiddenMutation } from './record-adapter';

type CrmEntityActionItem = {
  id: string;
  label: string;
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  onClick: () => void | Promise<void>;
};
/** CRM actions contributed to shared entity menus. */
export function createCrmEntityActionItems() {
  const canManage = useIsTeamAdmin();
  const hiddenMutation = useSetCompanyHiddenMutation();
  const hideCompanyAction = makeHideCompanyAction({
    canManage,
    setHidden: (companyId, hidden) =>
      hiddenMutation.mutateAsync({ companyId, hidden }),
  });
  const setCompanyPropertyAction = makeSetCompanyPropertyAction();

  return (
    entities: EntityData[],
    soup: EntityActionListState
  ): CrmEntityActionItem[] => {
    const canExecuteAll = (canExecute: (entity: EntityData) => boolean) =>
      entities.length > 0 && entities.every(canExecute);
    // CRM group: Set stage/owner/revenue on the whole company
    // selection, Archive / Restore for a single company.
    const crmItems: CrmEntityActionItem[] = [];

    for (const [field, label, icon] of [
      ['stage', 'Set stage', FlagIcon],
      ['owner', 'Set owner', UserIcon],
      ['revenue', 'Set revenue', CurrencyDollarIcon],
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
        icon,
        onClick: () => setCompanyPropertyAction.execute(entities, field),
      });
    }

    const singleEntity = entities.length === 1 ? entities[0] : undefined;
    if (
      singleEntity?.type === 'crm_company' &&
      hideCompanyAction.canExecute(singleEntity)
    ) {
      crmItems.push({
        id: 'hide-company',
        icon: singleEntity.hidden ? ArrowCounterClockwiseIcon : ArchiveIcon,
        label: singleEntity.hidden
          ? t('viewMenus.crmRestore')
          : t('viewMenus.crmArchive'),
        onClick: () => hideCompanyAction.executeWithSoup(entities, soup),
      });
    }

    return crmItems;
  };
}
