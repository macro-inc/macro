import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import type { ManagedDialogProps } from '@ui';
import { createSignal, Match, Show, Switch } from 'solid-js';
import { DeleteProjectsDialog } from '../components/delete-projects-dialog';
import { RenameProjectDialog } from '../components/rename-project-dialog';
import { useProjectsContext } from '../context/projects-context';
import { ProjectShareLauncher } from '../project-share';
import { Projects } from '../projects';

/** A project action chosen from a list row's menu outside the Projects view. */
export type ProjectEntityAction =
  | { kind: 'rename'; id: string; name: string }
  | { kind: 'share'; id: string }
  | { kind: 'delete'; ids: readonly string[] };

type ProjectEntityActionDialogProps = ManagedDialogProps & {
  action: ProjectEntityAction;
};

/**
 * Runs one project action with the Projects view's own dialogs and commands,
 * for hosts such as Home and Search that list projects as ordinary entities.
 */
export function ProjectEntityActionDialog(
  props: ProjectEntityActionDialogProps
) {
  return (
    <Show when={props.open}>
      <Projects>
        <ProjectEntityActionContent
          action={props.action}
          onClose={() => props.onOpenChange(false)}
        />
      </Projects>
    </Show>
  );
}

export function ProjectEntityActionContent(props: {
  action: ProjectEntityAction;
  onClose(): void;
}) {
  const commands = useProjectsContext().createCommands();
  return (
    <Switch>
      <Match when={props.action.kind === 'rename' && props.action}>
        {(action) => (
          <RenameProjectDialog
            name={action().name}
            onOpenChange={(open) => !open && props.onClose()}
            onRename={async (name) => {
              await commands.rename(action().id, name);
              toast.success('Project renamed');
            }}
          />
        )}
      </Match>
      <Match when={props.action.kind === 'share' && props.action}>
        {(action) => (
          <ProjectShareLauncher projectId={action().id} onClose={props.onClose} />
        )}
      </Match>
      <Match when={props.action.kind === 'delete' && props.action}>
        {(action) => (
          <DeleteProjects
            ids={action().ids}
            deleteMany={commands.deleteMany}
            onClose={props.onClose}
          />
        )}
      </Match>
    </Switch>
  );
}

/** Confirms, deletes, and keeps only the failures for a retry. */
function DeleteProjects(props: {
  ids: readonly string[];
  deleteMany(ids: readonly string[]): Promise<string[]>;
  onClose(): void;
}) {
  const [remaining, setRemaining] = createSignal(props.ids);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const run = async () => {
    const ids = remaining();
    setPending(true);
    let failed: readonly string[];
    try {
      failed = await props.deleteMany(ids);
    } catch (error) {
      console.error('Failed to delete projects', error);
      failed = ids;
    } finally {
      setPending(false);
    }
    if (failed.length === 0) {
      props.onClose();
      toast.success(
        ids.length > 1 ? `Deleted ${ids.length} projects` : 'Project deleted'
      );
      return;
    }
    setRemaining(failed);
    setError(
      failed.length === ids.length
        ? 'Could not delete. Please try again.'
        : `Deleted ${ids.length - failed.length} of ${ids.length}. The rest could not be deleted.`
    );
  };
  return (
    <DeleteProjectsDialog
      count={remaining().length}
      pending={pending()}
      error={error()}
      onOpenChange={(open) => !open && !pending() && props.onClose()}
      onDelete={() => fireAndForget(run(), 'projects')}
    />
  );
}
