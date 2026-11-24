import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { PhoneAgentsNavigation } from './agents-navigation';

const collapse = vi.hoisted(() => vi.fn());
vi.mock('@app/components/view-shell', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/components/view-shell')>()),
  useViewShell: () => ({ aside: { collapse } }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('renders the shared navigation destinations and each routine, not custom agents or old sections', () => {
  const openPage = vi.fn();
  const openRoutine = vi.fn();
  render(() => (
    <PhoneAgentsNavigation
      activePage="archived"
      archivedCount={12}
      routines={[{ id: 'routine-a', name: 'Daily summary', schedule: 'Daily' }]}
      onOpenPage={openPage}
      onOpenRoutine={openRoutine}
      onCreateAgent={() => {}}
      onCreateRoutine={() => {}}
    />
  ));
  const archived = screen.getByRole('button', { name: 'Archived 12' });
  expect(archived.getAttribute('aria-current')).toBe('page');
  expect(archived.className).toContain('bg-active');
  expect(screen.queryByText('Connections')).toBeNull();
  expect(screen.queryByText('Open PRs')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Conversations' }));
  expect(openPage).toHaveBeenCalledWith('new');
  fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
  expect(openPage).toHaveBeenCalledWith('agents');
  fireEvent.click(screen.getByRole('button', { name: 'Daily summary Daily' }));
  expect(openRoutine).toHaveBeenCalledWith('routine-a');
});

it('keeps trailing create actions independent from row navigation and dismisses the drawer', () => {
  const openPage = vi.fn();
  const createAgent = vi.fn();
  const createRoutine = vi.fn();
  render(() => (
    <PhoneAgentsNavigation
      activePage="new"
      routines={[]}
      onOpenPage={openPage}
      onOpenRoutine={() => {}}
      onCreateAgent={createAgent}
      onCreateRoutine={createRoutine}
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'New agent' }));
  expect(createAgent).toHaveBeenCalledOnce();
  expect(openPage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Create routine' }));
  expect(createRoutine).toHaveBeenCalledOnce();
  expect(collapse).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: 'Archived' }).textContent).toBe(
    'Archived'
  );
});
