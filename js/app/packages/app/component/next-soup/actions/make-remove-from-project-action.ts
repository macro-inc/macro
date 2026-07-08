import { useMaybePreviewPanel } from '@app/component/PreviewPanel';
import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import { createBulkRemoveFromProjectDssEntityMutation } from '@macro-entity';
import type { SoupState } from '../create-soup-state';
import { restoreSoupFocus } from '../utils';

/** Clear the entities' folder (set their project to none). */
export const makeRemoveFromProjectAction = () => {
  const removeMutation = createBulkRemoveFromProjectDssEntityMutation();

  const canExecute = (entity: EntityData): boolean =>
    entity.type === 'document' ||
    entity.type === 'chat' ||
    entity.type === 'project' ||
    entity.type === 'email';

  const execute = async (entities: EntityData[]) => {
    // Failure toast is shown by the mutation
    const result = await removeMutation
      .mutateAsync({ entities })
      .catch(() => null);
    if (!result) return;
    toast.success(
      entities.length > 1
        ? `Removed ${entities.length} items from folder`
        : 'Removed from folder'
    );
  };

  const previewPanel = useMaybePreviewPanel();

  const executeWithSoup = async (entities: EntityData[], soup: SoupState) => {
    // Entities leave the viewed folder's list; move focus to a neighbor
    const currentIndex = soup.focus.index();
    const nextRow =
      soup.items.at(currentIndex + 1) ?? soup.items.at(currentIndex - 1);
    const inPreview = previewPanel !== undefined;

    await execute(entities);

    soup.selection.clear();
    if (nextRow) {
      soup.focus.set(nextRow.id);
    }
    restoreSoupFocus(nextRow?.id, inPreview);
  };

  return { canExecute, execute, executeWithSoup };
};
