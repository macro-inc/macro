import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmailBulkSelectionState } from '../primitives/bulk-selection';
import { EmailBulkBar } from './EmailBulkBar';

vi.mock('@ui', async () => ({
  Button: (await import('@app/components/ui/components/Button')).Button,
  Hotkey: () => null,
  Layer: (props: ParentProps) => props.children,
}));
vi.mock('@core/component/ScopedPortal', () => ({
  ScopedPortal: (props: ParentProps) => props.children,
}));

afterEach(cleanup);

const query = { ef: null, emailView: 'inbox' };
const target = (id: string) => ({
  id,
  done: false,
  read: false,
  sortTs: '2025-03-01T09:00:00Z',
});

function renderBar(
  state: EmailBulkSelectionState,
  progress?: { label: string; completed: number; total: number }
) {
  const handlers = { onClear: vi.fn(), onRetry: vi.fn(), onRun: vi.fn() };
  render(() => (
    <EmailBulkBar
      state={state}
      progress={progress}
      viewLabel="Signal"
      {...handlers}
    />
  ));
  return handlers;
}

describe('EmailBulkBar', () => {
  it('counts what is selected below the row and runs Done and Mark read', () => {
    const handlers = renderBar({
      status: 'ready',
      scope: 'below',
      anchorId: 'thread-1',
      query,
      targets: Array.from({ length: 2341 }, (_, index) =>
        target(`thread-${index}`)
      ),
    });

    expect(
      screen.getByText('All 2,341 conversations below selected')
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark read' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(handlers.onRun.mock.calls).toEqual([['done'], ['read']]);
    expect(handlers.onClear).toHaveBeenCalledOnce();
  });

  it('names the view when everything in it is selected', () => {
    renderBar({
      status: 'ready',
      scope: 'view',
      query,
      targets: [target('thread-1')],
    });

    expect(
      screen.getByText('All 1 conversation in Signal selected')
    ).toBeTruthy();
  });

  it('shows the running count while selecting, and can be cleared', () => {
    const handlers = renderBar({
      status: 'resolving',
      scope: 'below',
      anchorId: 'thread-1',
      query,
      count: 1500,
    });

    expect(screen.getByText('Selecting… 1,500 conversations')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark done' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(handlers.onClear).toHaveBeenCalledOnce();
  });

  it('shows progress while an action runs, without a way to dismiss it', () => {
    renderBar(
      { status: 'idle' },
      { label: 'Marking done', completed: 300, total: 2341 }
    );

    expect(
      screen.getByText('Marking done… 300 of 2,341 conversations')
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  it('explains a failed selection and retries it', () => {
    const handlers = renderBar({
      status: 'failed',
      scope: 'below',
      anchorId: 'thread-1',
      query,
      message: 'That email is no longer in Signal.',
    });

    expect(screen.getByText('That email is no longer in Signal.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(handlers.onRetry).toHaveBeenCalledOnce();
  });

  it('renders nothing without a selection or a running action', () => {
    renderBar({ status: 'idle' });

    expect(screen.queryByRole('button')).toBeNull();
  });
});
