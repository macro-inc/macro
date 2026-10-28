import { fireAndForget } from '@core/util/fireAndForget';
import { Dialog, type ManagedDialogProps } from '@ui';
import { type Accessor, createEffect, type JSX, on, onCleanup } from 'solid-js';
import {
  DeleteSavedViewConfirmation,
  SavedViewForm,
} from '../components/saved-view-dialog';
import type { SavedView } from '../core/saved-view';
import {
  savedViewErrorMessage,
  useCreateSavedView,
  useDeleteSavedView,
  useUpdateSavedView,
} from '../queries/saved-view-actions';
import { toSavedView } from '../queries/saved-views';

type Scope = ManagedDialogProps & {
  refresh: () => Promise<unknown>;
  viewerId: Accessor<string | undefined>;
  isCurrent: () => boolean;
};

// Closing a dialog cancels its UI completion, not a server write already sent.
function createDialogLifetime(props: Scope, ownerId?: string) {
  const viewer = props.viewerId();
  let alive = true;
  const sameAccount = () => Boolean(viewer) && props.viewerId() === viewer;
  const current = () =>
    alive &&
    sameAccount() &&
    (!ownerId || ownerId === viewer) &&
    props.isCurrent();
  createEffect(
    on(current, (valid) => {
      if (!valid) props.onOpenChange(false);
    })
  );
  onCleanup(() => {
    alive = false;
  });
  return { current, sameAccount, viewer };
}

export function SavedViewDialog(
  props: Scope & {
    summary?: JSX.Element;
    team?: { id: string; name: string };
    title?: string;
    submitLabel?: string;
    onSaved: (record: SavedView) => void;
  } & (
      | { mode: 'create'; id: string; name: string; config: unknown }
      | { mode: 'edit'; record: SavedView }
    )
) {
  const lifetime = createDialogLifetime(
    props,
    props.mode === 'edit' ? props.record.ownerId : undefined
  );
  const create = useCreateSavedView({ refresh: props.refresh });
  const update = useUpdateSavedView({ refresh: props.refresh });
  const mutation = () => (props.mode === 'edit' ? update : create);
  const save = async (name: string, sharedTeamId: string | null) => {
    if (!lifetime.current() || mutation().isPending) return;
    let record: SavedView | undefined;
    if (props.mode === 'edit') {
      const result = await update.mutateAsync({
        id: props.record.id,
        name,
        config: props.record.config,
        expectedRevision: props.record.revision,
        sharedTeamId:
          sharedTeamId === props.record.sharedTeamId ? undefined : sharedTeamId,
      });
      if (!result.error && result.data?.updateSavedView)
        record = toSavedView(result.data.updateSavedView);
    } else {
      const result = await create.mutateAsync({
        id: props.id,
        name,
        config: props.config,
        sharedTeamId,
      });
      if (!result.error && result.data?.createSavedView)
        record = toSavedView(result.data.createSavedView);
    }
    if (record && lifetime.current()) {
      props.onSaved(record);
      props.onOpenChange(false);
    }
  };
  return (
    <Dialog
      open={props.open}
      position="center"
      class="w-150"
      onOpenChange={(open) => {
        if (!mutation().isPending) props.onOpenChange(open);
      }}
    >
      <SavedViewForm
        {...props}
        name={props.mode === 'edit' ? props.record.name : props.name}
        sharedTeamId={props.mode === 'edit' ? props.record.sharedTeamId : null}
        title={
          props.title ??
          (props.mode === 'edit' ? `Edit “${props.record.name}”` : 'Save view')
        }
        submitLabel={
          props.submitLabel ??
          (props.mode === 'edit' ? 'Save changes' : 'Save view')
        }
        pending={mutation().isPending}
        error={savedViewErrorMessage(mutation().error)}
        onSave={(name, team) => fireAndForget(save(name, team), 'saved-views')}
      />
    </Dialog>
  );
}

export function DeleteSavedViewDialog(
  props: Scope & {
    record: SavedView;
    onDeleted: (record: SavedView, viewer: string) => void;
  }
) {
  const lifetime = createDialogLifetime(props, props.record.ownerId);
  const mutation = useDeleteSavedView({ refresh: props.refresh });
  const remove = async () => {
    if (!lifetime.current() || mutation.isPending) return;
    const result = await mutation.mutateAsync({
      id: props.record.id,
      expectedRevision: props.record.revision,
    });
    if (
      !result.error &&
      result.data &&
      lifetime.sameAccount() &&
      lifetime.viewer
    ) {
      // A confirmed delete also applies when navigation selected this record while pending.
      props.onDeleted(props.record, lifetime.viewer);
      props.onOpenChange(false);
    }
  };
  return (
    <DeleteSavedViewConfirmation
      {...props}
      name={props.record.name}
      pending={mutation.isPending}
      error={savedViewErrorMessage(mutation.error)}
      onDelete={() => fireAndForget(remove(), 'saved-views')}
    />
  );
}
