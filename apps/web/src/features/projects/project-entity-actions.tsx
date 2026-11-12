import { toast } from '@core/component/Toast/Toast';
import { lazyNamed } from '@core/util/lazyNamed';
import { type ManagedDialogProps, openDialog } from '@ui';
import { ErrorBoundary, Suspense } from 'solid-js';
import type { ProjectEntityAction } from './views/project-entity-action';

export type { ProjectEntityAction } from './views/project-entity-action';

const ProjectEntityActionDialog = lazyNamed(
  () => import('./views/project-entity-action'),
  'ProjectEntityActionDialog'
);

/**
 * The dialog host sits above the app shell, so the chunk loads and fails
 * here rather than suspending or erroring the whole app.
 */
function LoadedProjectEntityActionDialog(
  props: ManagedDialogProps & { action: ProjectEntityAction }
) {
  return (
    <ErrorBoundary
      fallback={() => {
        toast.failure('Could not open this project action', {
          subtext: 'Please try again',
        });
        queueMicrotask(() => props.onOpenChange(false));
        return null;
      }}
    >
      <Suspense>
        <ProjectEntityActionDialog {...props} />
      </Suspense>
    </ErrorBoundary>
  );
}

/**
 * Opens a project action from a menu whose owner closes with it, so the
 * dialog lives in the app's dialog host instead.
 */
export function openProjectEntityAction(action: ProjectEntityAction) {
  return openDialog(LoadedProjectEntityActionDialog, { action });
}
