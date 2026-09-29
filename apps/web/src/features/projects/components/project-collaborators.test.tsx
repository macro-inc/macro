import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { ProjectDetail } from '../core/project';
import { ProjectCollaborators } from './project-collaborators';

vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));
vi.mock('@property/editors/selectors/PropertyEntitySelector', () => ({
  PropertyEntitySelector: () => null,
}));
vi.mock('@core/component/TopBar/ShareButton', () => ({
  ShareOptions: (props: {
    label: string;
    setPermissions(level: null): void;
  }) => (
    <button onClick={() => props.setPermissions(null)}>{props.label}</button>
  ),
}));
vi.mock('@ui', () => ({
  Button: (props: ParentProps<{ onClick(): void }>) => (
    <button onClick={props.onClick}>{props.children}</button>
  ),
  Dropdown: Object.assign(
    (props: ParentProps<{ onOpenChange(open: boolean): void }>) => (
      <div>
        <button onClick={() => props.onOpenChange(true)}>Open picker</button>
        {props.children}
      </div>
    ),
    {
      Trigger: (props: ParentProps) => props.children,
      Content: (props: ParentProps) => props.children,
    }
  ),
}));
afterEach(cleanup);
const project: ProjectDetail = {
  id: 'p',
  name: 'Project',
  descriptionSurfaceId: 'd',
  updatedAt: '',
  ownerId: 'owner',
  createdAt: '',
  memberIds: ['owner', 'alice', 'bob'],
  taskIds: [],
  access: 'owner',
};
it('omits the owner consistently for individual removals and picker saves', async () => {
  const onMembers = vi.fn(async () => {});
  const view = render(() => (
    <ProjectCollaborators
      project={project}
      pending={false}
      getUserName={(id) => id}
      onMembers={onMembers}
    />
  ));
  fireEvent.click(view.getByRole('button', { name: 'Access for alice' }));
  await waitFor(() => expect(onMembers).toHaveBeenCalledWith(['bob']));
  fireEvent.click(view.getByRole('button', { name: 'Open picker' }));
  fireEvent.click(view.getByRole('button', { name: 'Save collaborators' }));
  await waitFor(() =>
    expect(onMembers).toHaveBeenLastCalledWith(['alice', 'bob'])
  );
});
