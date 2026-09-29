import { getPermissions } from '@core/component/SharePermissions';
import { toast } from '@core/component/Toast/Toast';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { getDisplayName, tryMacroId } from '@core/user';
import { type Accessor, onMount, Show } from 'solid-js';
import { ProjectCollaborators } from './components/project-collaborators';
import {
  type ProjectsContext,
  useProjectsContext,
} from './context/projects-context';
import type { ProjectDetail } from './core/project';

const userName = (id: string) => getDisplayName(tryMacroId(id));

/** The standard Share menu; collaborators are the project's direct grants. */
export function useProjectShareModal(
  project: Accessor<ProjectDetail | undefined>,
  commands: ReturnType<ProjectsContext['createCommands']>,
  options: { onClose?: () => void } = {}
) {
  const setMembers = async (id: string, memberIds: string[]) => {
    try {
      await commands.setMembers(id, memberIds);
    } catch (error) {
      toast.failure('Could not update collaborators', {
        subtext: 'Please try again',
      });
      throw error;
    }
  };
  // Stable, so the open dialog keeps the picker's draft across refreshes.
  const Collaborators = () => (
    <Show when={project()}>
      {(current) => (
        <ProjectCollaborators
          project={current()}
          getUserName={userName}
          pending={commands.pending()}
          onMembers={(ids) => setMembers(current().id, ids)}
        />
      )}
    </Show>
  );
  return useShareModal(() => {
    const current = project();
    if (!current) return;
    return {
      id: current.id,
      blockAlias: 'initiative',
      itemType: 'initiative',
      name: current.name,
      owner: current.ownerId,
      userPermissions: getPermissions(current.access),
      people: Collaborators,
      hasDirectShares: current.memberIds.some((id) => id !== current.ownerId),
    };
  }, options);
}

/** Opens a listed project's Share menu once its detail has loaded. */
export function ProjectShareLauncher(props: {
  projectId: string;
  onClose(): void;
}) {
  const context = useProjectsContext();
  const source = context.createProjectSource(() => props.projectId);
  const openShare = useProjectShareModal(
    source.project,
    context.createCommands(),
    { onClose: props.onClose }
  );
  onMount(openShare);
  return null;
}
