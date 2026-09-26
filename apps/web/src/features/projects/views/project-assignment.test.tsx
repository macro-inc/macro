import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProjectAssignment } from './project-assignment';

vi.mock(
  '@app/components/view-shell',
  async () => await import('@app/components/view-shell/SearchBar')
);
vi.mock('@ui', async () => ({
  ...(await import('@app/components/ui/components/Button')),
  ...(await import('@app/components/ui/components/Dialog')),
  ...(await import('@app/components/ui/components/Surface')),
  ...(await import('@app/components/ui/utils/classname')),
  Hotkey: () => null,
}));
vi.mock('@app/components/ui/components/Tooltip', () => ({
  Tooltip: (props: ParentProps) => props.children,
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('../context/projects-context', () => ({
  useProjectsContext: () => ({
    createCollectionSource: () => ({
      rows: () => [],
      loading: () => false,
      error: () => undefined,
      hasMore: () => false,
    }),
    createCommands: () => ({
      pending: () => false,
      assignTasks: async () => [
        { taskId: 'task', error: 'You need edit access to this task.' },
      ],
    }),
  }),
}));
beforeEach(() => vi.stubGlobal('scrollTo', vi.fn()));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each(['Escape', 'Cancel'])(
  'allows %s after a recoverable assignment error',
  async (action) => {
    const close = vi.fn();
    render(() => <ProjectAssignment taskIds={['task']} onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'No project' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      '1 tasks could not be updated. You need edit access to this task.'
    );
    if (action === 'Escape') {
      const search = screen.getByRole('searchbox', { name: 'Search projects' });
      search.focus();
      fireEvent.keyDown(search, { key: 'Escape' });
    } else fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(close).toHaveBeenCalledOnce();
  }
);
