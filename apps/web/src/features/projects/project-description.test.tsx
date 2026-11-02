import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const sessions = vi.hoisted(() => ({
  create: vi.fn((_projectId: string, _options: { viewer: string | null }) => ({
    connectionError: () => 'offline',
    absent: () => false,
    dispose: () => {},
  })),
}));
const [authenticated, setAuthenticated] = createSignal<boolean | undefined>(
  true
);
vi.mock('@core/auth', () => ({ useIsAuthenticated: () => authenticated }));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user-1' }));
vi.mock('./queries/production-project-description', () => ({
  createProductionProjectDescriptionSession: sessions.create,
}));
vi.mock('@core/collab-surface/CollabMarkdownEditor', () => ({
  CollabMarkdownEditor: () => null,
}));
vi.mock('@ui', () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
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
  setAuthenticated(true);
});

it('opens one session per project and retry, not per project refresh', () => {
  const [project, setProject] = createSignal({ id: 'a', name: 'Plan' });
  const view = render(() => (
    <ProjectDescription projectId={project().id} canEdit={true} />
  ));
  const opened = () => sessions.create.mock.calls.map(([id]) => id);
  setProject({ id: 'a', name: 'Renamed' });
  expect(opened()).toEqual(['a']);
  setProject({ id: 'b', name: 'Other' });
  expect(opened()).toEqual(['a', 'b']);
  fireEvent.click(view.getByText('Retry description'));
  expect(opened()).toEqual(['a', 'b', 'b']);
});

it('opens once sign-in settles, ensuring the surface only for an account', () => {
  setAuthenticated(undefined);
  render(() => <ProjectDescription projectId="a" canEdit={false} />);
  expect(sessions.create).not.toHaveBeenCalled();
  setAuthenticated(false);
  expect(sessions.create.mock.calls).toEqual([['a', { viewer: null }]]);
  setAuthenticated(true);
});
