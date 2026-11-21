import { t } from '@app/lib/i18n';
import { onCleanup, Show } from 'solid-js';
import type { SavedViewCreation } from '../primitives/create-saved-view-creation';
import {
  savedViewErrorMessage,
  useCreateSavedView,
  useUpdateSavedView,
} from '../queries/saved-view-actions';
import { toSavedView } from '../queries/saved-views';
import { SavedViewLeaveGuard } from './saved-view-leave-guard';

/** Route-owned persistence and leave protection, independent of sidebar mounting. */
export function SavedViewDraftHost(props: {
  creation: SavedViewCreation;
  refresh: () => Promise<unknown>;
  discard: () => void;
  selection: Readonly<Record<string, readonly string[]>>;
  registerLeave?: (run: (action: () => void) => void) => () => void;
}) {
  const mutation = useCreateSavedView({ refresh: props.refresh });
  const update = useUpdateSavedView({ refresh: props.refresh });
  onCleanup(
    props.creation.registerSave(async (draft) => {
      const existing = props.creation.persisted();
      if (existing) {
        const result = await update.mutateAsync({
          id: draft.id,
          name: draft.name,
          config: draft.config,
          sharedTeamId: draft.sharedTeamId,
          expectedRevision: existing.revision,
        });
        if (result.error)
          throw new Error(
            savedViewErrorMessage(result.error) ?? t('viewMenus.saveViewFailed')
          );
        if (!result.data?.updateSavedView)
          throw new Error(t('viewMenus.saveViewFailed'));
        return toSavedView(result.data.updateSavedView);
      }
      const result = await mutation.mutateAsync({
        id: draft.id,
        name: draft.name,
        config: draft.config,
        sharedTeamId: draft.sharedTeamId,
        appearance: draft.appearance,
      });
      if (result.error)
        throw new Error(
          savedViewErrorMessage(result.error) ?? t('viewMenus.saveViewFailed')
        );
      if (!result.data?.createSavedView)
        throw new Error(t('viewMenus.saveViewFailed'));
      return toSavedView(result.data.createSavedView);
    })
  );
  return (
    <Show when={props.creation.current()?.id} keyed>
      {(_draftId) => (
        <SavedViewLeaveGuard
          creation={props.creation}
          discard={props.discard}
          selection={props.selection}
          registerLeave={props.registerLeave}
        />
      )}
    </Show>
  );
}
