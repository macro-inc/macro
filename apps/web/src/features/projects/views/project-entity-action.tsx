import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import type { ManagedDialogProps } from '@ui';
import { createSignal, Match, Show, Switch } from 'solid-js';
import { DeleteProjectsDialog } from '../components/delete-projects-dialog';
import { RenameProjectDialog } from '../components/rename-project-dialog';
import {
  ProjectsProvider,
  useProjectsContext,
} from '../context/projects-context';
import { ProjectShareLauncher } from '../project-share';
import { createProjectsContext } from '../projects';

/** A project action chosen from a list row's menu outside the Projects view. */
export type ProjectEntityAction =
  | { kind: 'rename'; id: string; name: string }
  | { kind: 'share'; id: string }
  | { kind: 'delete'; ids: readonly string[] };

export type ProjectEntityActionOptions = {
  /** Called with the projects a delete removed, including a partial one. */
  onDeleted?(ids: readonly string[]): void;
};

type ProjectEntityActionDialogProps = ManagedDialogProps & {
  action: ProjectEntityAction;
  options?: ProjectEntityActionOptions;
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
      {/* Not the view's <Projects>: its inline fallbacks would land in the
          page, outside any dialog. The menu already checked the flag. */}
      <ProjectsProvider context={createProjectsContext()}>
        <ProjectEntityActionContent
          action={props.action}
          options={props.options}
          onClose={() => props.onOpenChange(false)}
        />
      </ProjectsProvider>
    </Show>
  );
}

export function ProjectEntityActionContent(props: {
  action: ProjectEntityAction;
  options?: ProjectEntityActionOptions;
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
              toast.success(t('entityActions.toastProjectRenamed'));
            }}
          />
        )}
      </Match>
      <Match when={props.action.kind === 'share' && props.action}>
        {(action) => (
          <ProjectShareLauncher
            projectId={action().id}
            onClose={props.onClose}
          />
        )}
      </Match>
      <Match when={props.action.kind === 'delete' && props.action}>
        {(action) => (
          <DeleteProjects
            ids={action().ids}
            deleteMany={commands.deleteMany}
            onDeleted={props.options?.onDeleted}
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
  onDeleted?(ids: readonly string[]): void;
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
    const deleted = ids.filter((id) => !failed.includes(id));
    if (deleted.length > 0) props.onDeleted?.(deleted);
    if (failed.length === 0) {
      props.onClose();
      toast.success(
        t('entityActions.toastProjectsDeleted', { count: ids.length })
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
