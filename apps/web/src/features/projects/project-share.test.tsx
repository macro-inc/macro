import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { ImperativeDialogHost } from '@ui';
import { createSignal, Show } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import {
  type ProjectsContext,
  ProjectsProvider,
} from './context/projects-context';
import type { ProjectDetail } from './core/project';
import { ProjectShareLauncher } from './project-share';

vi.mock('@core/component/TopBar/ShareButton', () => ({
  ShareModal: (props: {
    name: string;
    itemType: string;
    userPermissions: string;
    hasDirectShares?: boolean;
    onOpenChange: (open: boolean) => void;
  }) => (
    <button
      type="button"
      data-testid="share-modal"
      data-item-type={props.itemType}
      data-permissions={props.userPermissions}
      data-direct-shares={String(props.hasDirectShares)}
      onClick={() => props.onOpenChange(false)}
    >
      {props.name}
    </button>
  ),
}));
vi.mock('@core/user', () => ({
  getDisplayName: (id: string) => id,
  tryMacroId: (id: string) => id,
}));
vi.mock('./components/project-collaborators', () => ({
  ProjectCollaborators: () => null,
}));

afterEach(cleanup);

const detail: ProjectDetail = {
  id: 'launch',
  name: 'Launch',
  descriptionDocumentId: 'description',
  updatedAt: '',
  ownerId: 'owner',
  memberIds: ['owner', 'collaborator'],
  taskIds: [],
  access: 'owner',
  createdAt: '',
};

it('opens a listed project’s Share menu once its detail loads', async () => {
  const [project, setProject] = createSignal<ProjectDetail>();
  const [sharing, setSharing] = createSignal(true);
  const requested: string[] = [];
  const unused = (): never => {
    throw new Error('Unused capability');
  };
  const context: ProjectsContext = {
    userId: () => 'owner',
    createCollectionSource: unused,
    createPropertyDefinitionsSource: unused,
    createReferencesSource: unused,
    createProjectSource: (id) => {
      requested.push(id());
      return {
        project,
        properties: () => [],
        loading: () => !project(),
        error: () => undefined,
        refresh: async () => {},
      };
    },
    createCommands: () => ({
      createTask: vi.fn(),
      pending: () => false,
      create: vi.fn(),
      rename: vi.fn(),
      setMembers: vi.fn(),
      assignTasks: vi.fn(),
      delete: vi.fn(),
      saveProperty: vi.fn(),
    }),
  };
  render(() => (
    <ProjectsProvider context={context}>
      <Show when={sharing()}>
        <ProjectShareLauncher
          projectId="launch"
          onClose={() => setSharing(false)}
        />
      </Show>
      <ImperativeDialogHost />
    </ProjectsProvider>
  ));

  expect(requested).toEqual(['launch']);
  expect(screen.queryByTestId('share-modal')).toBeNull();
  setProject(detail);
  const modal = await screen.findByTestId('share-modal');
  expect(modal.textContent).toBe('Launch');
  expect(modal.dataset).toMatchObject({
    itemType: 'initiative',
    permissions: 'Owner',
    directShares: 'true',
  });

  fireEvent.click(modal);
  await vi.waitFor(() => expect(sharing()).toBe(false));
  expect(screen.queryByTestId('share-modal')).toBeNull();
});
