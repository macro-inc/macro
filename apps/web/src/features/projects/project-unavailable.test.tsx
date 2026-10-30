import type { SharingSource } from '@app/features/access-requests/context/contracts';
import { fakeSharingSource } from '@app/features/access-requests/tests/source';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

let source: SharingSource;
vi.mock('@app/features/access-requests/queries/source', () => ({
  createSharingSource: () => source,
}));
vi.mock('@core/auth', () => ({ useIsAuthenticated: () => () => true }));
vi.mock('@core/context/user', () => ({ useEmail: () => () => undefined }));
vi.mock('./components/project-skeletons', () => ({
  ProjectContentSkeleton: () => <div aria-busy="true">Loading project</div>,
}));

import { ProjectUnavailable } from './project-unavailable';

afterEach(cleanup);
const projectId = '01992d2f-8444-7000-8000-000000000001';

function renderUnavailable(onRetry = vi.fn(async () => {})) {
  const view = render(() => (
    <ProjectUnavailable
      projectId={projectId}
      section="overview"
      onRetry={onRetry}
    />
  ));
  return { ...view, onRetry };
}

it('lets a viewer without access request it and reloads the project once granted', async () => {
  const fake = fakeSharingSource({ accessLevel: null });
  source = fake.source;
  const reload = Promise.withResolvers<void>();
  const view = renderUnavailable(vi.fn(() => reload.promise));
  expect(view.getByText("You don't have access to this project")).toBeTruthy();
  expect(view.queryByRole('alert')).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'Request access' }));
  expect(source.submit).toHaveBeenCalledWith('view', undefined);
  fake.setState((current) => ({ ...current, accessLevel: 'view' }));
  expect(view.onRetry).toHaveBeenCalledOnce();
  // The request view holds while the project reloads.
  expect(view.getByText("You don't have access to this project")).toBeTruthy();
  expect(view.queryByText(/Project unavailable/)).toBeNull();
  // A reload that leaves the project unavailable offers Try again.
  reload.resolve();
  expect(await view.findByRole('button', { name: 'Try again' })).toBeTruthy();
  expect(view.queryByText("You don't have access to this project")).toBeNull();
});

it('keeps the unavailable notice for a project whose request state cannot load', () => {
  source = {
    ...fakeSharingSource().source,
    state: () => undefined,
    error: () => 'Could not load access requests.',
  };
  const view = renderUnavailable();
  expect(view.getByRole('alert').textContent).toContain('Project unavailable');
  expect(view.queryByRole('button', { name: 'Request access' })).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'Try again' }));
  expect(view.onRetry).toHaveBeenCalledOnce();
  expect(source.refresh).toHaveBeenCalledOnce();
});

it('keeps the unavailable notice when the viewer already has access', () => {
  source = fakeSharingSource({ accessLevel: 'view' }).source;
  const view = renderUnavailable();
  expect(view.getByRole('alert').textContent).toContain('Project unavailable');
  expect(view.queryByRole('button', { name: 'Request access' })).toBeNull();
});

it('shows the project skeleton until the request state decides the view', () => {
  const [loading, setLoading] = createSignal(true);
  const [loaded, setLoaded] = createSignal(false);
  const fake = fakeSharingSource({ accessLevel: null });
  source = {
    ...fake.source,
    state: () => (loaded() ? fake.source.state() : undefined),
    loading,
  };
  const view = renderUnavailable();
  expect(view.getByText('Loading project')).toBeTruthy();
  expect(view.queryByRole('alert')).toBeNull();
  setLoaded(true);
  setLoading(false);
  expect(view.getByRole('button', { name: 'Request access' })).toBeTruthy();
});
