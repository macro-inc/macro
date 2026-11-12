import { lazyNamed } from '@core/util/lazyNamed';
import { openDialog } from '@ui';
import type { ProjectEntityAction } from './views/project-entity-action';

export type { ProjectEntityAction } from './views/project-entity-action';

const ProjectEntityActionDialog = lazyNamed(
  () => import('./views/project-entity-action'),
  'ProjectEntityActionDialog'
);

/**
 * Opens a project action from a menu whose owner closes with it, so the
 * dialog lives in the app's dialog host instead.
 */
export function openProjectEntityAction(action: ProjectEntityAction) {
  return openDialog(ProjectEntityActionDialog, { action });
}
