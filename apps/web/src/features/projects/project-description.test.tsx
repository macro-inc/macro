import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const sessions = vi.hoisted(() => ({
  create: vi.fn((_project: { projectId: string; surfaceId: string }) => ({
    connectionError: () => 'offline',
    dispose: () => {},
  })),
}));
vi.mock('./queries/production-project-description', () => ({
  createProductionProjectDescriptionSession: sessions.create,
}));
vi.mock('@core/collab-surface/CollabMarkdownEditor', () => ({
  CollabMarkdownEditor: () => null,
}));
vi.mock('@ui', () => ({
  Button: (props: ParentProps<{ onClick(): void }>) => (
    <button type="button" onClick={() => props.onClick()}>
      {props.children}
    </button>
  ),
}));

import { ProjectDescription } from './project-description';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('opens one session per description surface and retry, not per project refresh', () => {
  const [project, setProject] = createSignal({ descriptionSurfaceId: 'a' });
  const view = render(() => (
    <ProjectDescription
      projectId="project-1"
      surfaceId={project().descriptionSurfaceId}
      canEdit={true}
    />
  ));
  const opened = (surfaceId: string) => [{ projectId: 'project-1', surfaceId }];
  setProject({ descriptionSurfaceId: 'a' });
  expect(sessions.create.mock.calls).toEqual([opened('a')]);
  setProject({ descriptionSurfaceId: 'b' });
  expect(sessions.create.mock.calls).toEqual([opened('a'), opened('b')]);
  fireEvent.click(view.getByText('Retry description'));
  expect(sessions.create.mock.calls).toEqual([
    opened('a'),
    opened('b'),
    opened('b'),
  ]);
});

it('opens nothing until the project names its description surface', () => {
  render(() => (
    <ProjectDescription projectId="project-1" surfaceId="" canEdit={true} />
  ));
  expect(sessions.create).not.toHaveBeenCalled();
});
