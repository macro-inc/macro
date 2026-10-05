import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import {
  type Accessor,
  createResource,
  createRoot,
  createSignal,
  type ParentProps,
} from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { ProjectsSource } from '../context/projects-context';
import { ProjectsSidebar } from './projects-sidebar';

vi.mock('@app/components/view-shell', async () => ({
  ...(await import('@app/components/view-shell/CollapsibleSection')),
  ...(await import('@app/components/view-shell/ViewSidebar')),
}));
vi.mock('@app/components/view-shell/ViewShell', () => ({
  ViewSidebarCloseButton: () => null,
  ViewSidebarToggle: () => null,
}));
vi.mock('@ui', async () => ({
  ...(await import('@app/components/ui/utils/classname')),
  ...(await import('@app/components/ui/components/Button')),
}));
vi.mock('@app/components/ui/components/Tooltip', () => ({
  Tooltip: (props: ParentProps) => props.children,
}));
vi.mock('@solid-primitives/resize-observer', () => ({
  createResizeObserver: () => {},
}));
const context = vi.hoisted(() => ({ createCollectionSource: vi.fn() }));
vi.mock('../context/projects-context', () => ({
  useProjectsContext: () => context,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup(overrides: Partial<ProjectsSource> = {}) {
  const source: ProjectsSource = {
    rows: () => [
      {
        project: { id: 'launch', name: 'Launch', updatedAt: '' },
        properties: [],
      },
    ],
    loading: () => false,
    error: () => undefined,
    hasMore: () => false,
    loadingMore: () => false,
    loadMore: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    ...overrides,
  };
  let enabled: Accessor<boolean> = () => false;
  context.createCollectionSource.mockImplementation((_, isEnabled) => {
    enabled = isEnabled;
    return source;
  });
  const [open, setOpen] = createSignal(true);
  const onOpen = vi.fn();
  const onCreate = vi.fn();
  render(() => (
    <ProjectsSidebar
      open={open()}
      onOpenChange={setOpen}
      activeProjectId="launch"
      onOpen={onOpen}
      onCreate={onCreate}
    />
  ));
  return { source, onOpen, onCreate, enabled: () => enabled() };
}

it('highlights the active project and preserves the navigation gesture', () => {
  const { onOpen } = setup();
  const project = screen.getByRole('button', { name: 'Launch' });
  expect(project.getAttribute('aria-current')).toBe('page');
  fireEvent.click(project, { shiftKey: true });
  expect(onOpen).toHaveBeenCalledWith(
    'launch',
    expect.objectContaining({ shiftKey: true })
  );
});

it('collapses the list and disables reads, then restores it when expanded', async () => {
  const { enabled } = setup();
  const trigger = screen.getByRole('button', { name: 'My projects' });
  expect(enabled()).toBe(true);
  fireEvent.click(trigger);
  expect(enabled()).toBe(false);
  await waitFor(() =>
    expect(screen.queryByRole('navigation', { name: 'My projects' })).toBeNull()
  );
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(trigger);
  expect(enabled()).toBe(true);
  expect(screen.getByRole('button', { name: 'Launch' })).toBeTruthy();
});

it('distinguishes loading from an empty collection', () => {
  const [loading, setLoading] = createSignal(true);
  setup({ rows: () => [], loading });
  expect(screen.getByRole('status').textContent).toBe('Loading projects');
  expect(screen.queryByText('No projects yet')).toBeNull();
  setLoading(false);
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByText('No projects yet')).toBeTruthy();
});

it('keeps the heading and create action available while rows suspend', async () => {
  const pending = Promise.withResolvers<ReturnType<ProjectsSource['rows']>>();
  const resource = createRoot((dispose) => {
    const [rows] = createResource(() => pending.promise);
    return { rows, dispose };
  });
  try {
    const { onCreate } = setup({ rows: resource.rows });
    expect(
      screen.getByRole('status', { name: 'Loading projects' })
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'My projects' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    expect(onCreate).toHaveBeenCalledOnce();
    pending.resolve([]);
    expect(await screen.findByText('No projects yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'My projects' }));
    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    expect(onCreate).toHaveBeenCalledTimes(2);
  } finally {
    resource.dispose();
  }
});

it('guards pagination while pending and supports retry after a failed read', async () => {
  const request = Promise.withResolvers<void>();
  const { source } = setup({
    hasMore: () => true,
    loadMore: vi.fn(() => request.promise),
  });
  fireEvent.click(screen.getByRole('button', { name: 'Load more projects' }));
  expect(screen.getByRole('button', { name: 'Loading…' })).toHaveProperty(
    'disabled',
    true
  );
  expect(source.loadMore).toHaveBeenCalledOnce();
  request.reject(new Error('Network unavailable'));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Launch' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(source.refresh).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});
