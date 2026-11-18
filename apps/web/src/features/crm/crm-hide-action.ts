import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import { confirmDialog } from '@ui';
import type { EntityActionListState } from '../next-soup/actions/entity-action-context';
import { restoreSoupFocus } from '../next-soup/utils';

type MakeHideCompanyOptions = {
  canManage: () => boolean;
  setHidden: (companyId: string, hidden: boolean) => Promise<unknown>;
};

export const makeHideCompanyAction = (options: MakeHideCompanyOptions) => {
  const { setHidden } = options;

  let pending = false;
  const canExecute = (entity: EntityData): boolean =>
    entity.type === 'crm_company' && options.canManage();

  const executeWithSoup = async (
    entities: EntityData[],
    soup: EntityActionListState
  ) => {
    const entity = entities[0];
    if (entity?.type !== 'crm_company' || !options.canManage() || pending)
      return;
    pending = true;
    try {
      const confirmed = await confirmDialog({
        title: entity.hidden ? 'Restore company?' : 'Archive company?',
        confirmLabel: entity.hidden ? 'Restore' : 'Archive',
        body: entity.hidden
          ? 'Restore this company for your team and all of its people, including people archived individually. Email syncing stays off until enabled separately.'
          : 'Archive this company and all of its people for your team. Records and history are kept and can be restored later. Team email syncing will be turned off.',
      });
      if (!confirmed || !options.canManage()) return;

      // The row leaves or joins the selected view once soup
      // refetches, so move focus to a neighbour first — same as delete.
      const currentIndex = soup.focus.index();
      const nextRow =
        soup.items.at(currentIndex + 1) ?? soup.items.at(currentIndex - 1);
      const hidden = entity.hidden;

      try {
        await setHidden(entity.id, !hidden);
        soup.selection.clear();
        if (nextRow) soup.focus.set(nextRow.id);
        toast.success(hidden ? 'Company restored' : 'Company archived');
      } catch {
        toast.failure(
          hidden
            ? 'Could not restore. Try again.'
            : 'Could not archive. Try again.'
        );
      }

      await restoreSoupFocus(nextRow?.id);
    } finally {
      pending = false;
    }
  };

  return { canExecute, executeWithSoup };
};
