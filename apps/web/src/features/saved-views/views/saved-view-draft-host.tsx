import { t } from '@app/lib/i18n';
import { onCleanup } from 'solid-js';
import type { SavedViewCreation } from '../primitives/create-saved-view-creation';
import {
  savedViewErrorMessage,
  useCreateSavedView,
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
  onCleanup(
    props.creation.registerSave(async (draft) => {
      const result = await mutation.mutateAsync({
        id: draft.id,
        name: draft.name,
        config: draft.config,
        sharedTeamId: draft.sharedTeamId,
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
    <SavedViewLeaveGuard
      selection={props.selection}
      source={{
        identity: () => props.creation.current()?.id,
        viewerId: props.creation.viewerId,
        dirty: props.creation.dirty,
        allowNavigation: props.creation.isInternalNavigation,
        busy: props.creation.saving,
        save: props.creation.save,
        discard: props.discard,
        register: (run) => {
          const unregister = props.creation.register(run);
          const unregisterHost = props.registerLeave?.(run);
          return () => {
            unregister();
            unregisterHost?.();
          };
        },
      }}
    />
  );
}
