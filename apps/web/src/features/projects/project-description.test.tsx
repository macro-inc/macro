import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const sessions = vi.hoisted(() => ({
  create: vi.fn((_projectId: string) => ({
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

it('opens one session per project and retry, not per project refresh', () => {
  const [project, setProject] = createSignal({ id: 'a', name: 'Plan' });
  const view = render(() => (
    <ProjectDescription projectId={project().id} canEdit={true} />
  ));
  setProject({ id: 'a', name: 'Renamed' });
  expect(sessions.create.mock.calls).toEqual([['a']]);
  setProject({ id: 'b', name: 'Other' });
  expect(sessions.create.mock.calls).toEqual([['a'], ['b']]);
  fireEvent.click(view.getByText('Retry description'));
  expect(sessions.create.mock.calls).toEqual([['a'], ['b'], ['b']]);
});
