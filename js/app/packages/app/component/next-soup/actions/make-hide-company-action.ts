import { useMaybePreviewPanel } from '@app/component/PreviewPanel';
import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import type { SoupState } from '../create-soup-state';
import { restoreSoupFocus } from '../utils';

type MakeHideCompanyOptions = {
  // Admin/owner-only on the FE; the backend independently enforces
  // EditAccessLevel on PUT /crm/companies/{id}/hidden.
  isTeamAdmin: () => boolean;
  setHidden: (companyId: string, hidden: boolean) => Promise<unknown>;
};

export const makeHideCompanyAction = (options: MakeHideCompanyOptions) => {
  const { isTeamAdmin, setHidden } = options;

  const canExecute = (entity: EntityData): boolean =>
    entity.type === 'crm_company' && isTeamAdmin();

  const previewPanel = useMaybePreviewPanel();

  const executeWithSoup = async (entities: EntityData[], soup: SoupState) => {
    const entity = entities[0];
    if (entity?.type !== 'crm_company') return;

    // The row leaves (Hide) or joins (Unhide) the active list once soup
    // refetches, so move focus to a neighbour first — same as delete.
    const currentIndex = soup.focus.index();
    const nextRow =
      soup.items.at(currentIndex + 1) ?? soup.items.at(currentIndex - 1);
    const inPreview = previewPanel !== undefined;

    const hidden = entity.hidden;

    soup.selection.clear();
    if (nextRow) soup.focus.set(nextRow.id);

    try {
      await setHidden(entity.id, !hidden);
      toast.success(hidden ? 'Unhidden' : 'Hidden');
    } catch {
      toast.failure(hidden ? 'Failed to unhide' : 'Failed to hide');
    }

    await restoreSoupFocus(nextRow?.id, inPreview);
  };

  return { canExecute, executeWithSoup };
};
