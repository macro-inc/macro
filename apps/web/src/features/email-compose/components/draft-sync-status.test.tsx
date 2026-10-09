import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { DraftSyncViewState } from '../core/local-draft';
import { DraftSyncStatus } from './draft-sync-status';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const saved = (version: string): DraftSyncViewState => ({
  message: 'Draft saved',
  savedVersion: version,
  failed: false,
  canKeepEditing: false,
});

it('hides after two seconds and restarts only for another saved version', () => {
  vi.useFakeTimers();
  const [state, setState] = createSignal(saved('1'));
  render(() => (
    <DraftSyncStatus
      state={state()}
      busy={false}
      onRetry={() => {}}
      onKeepEditing={() => {}}
    />
  ));
  const label = screen.getByText('Draft saved');
  expect(label.getAttribute('aria-hidden')).toBe('false');
  vi.advanceTimersByTime(1_500);
  // Reading the same version again during queue settlement must not extend it.
  setState(saved('1'));
  vi.advanceTimersByTime(500);
  expect(label.getAttribute('aria-hidden')).toBe('true');
  setState(saved('2'));
  expect(label.getAttribute('aria-hidden')).toBe('false');
  vi.advanceTimersByTime(1_500);
  setState(saved('3'));
  vi.advanceTimersByTime(500);
  expect(label.getAttribute('aria-hidden')).toBe('false');
  vi.advanceTimersByTime(1_500);
  expect(label.getAttribute('aria-hidden')).toBe('true');
});

it('keeps retry visible until recovery, then briefly acknowledges success', () => {
  vi.useFakeTimers();
  const [state, setState] = createSignal(saved('1'));
  render(() => (
    <DraftSyncStatus
      state={state()}
      busy={false}
      onRetry={() => {}}
      onKeepEditing={() => {}}
    />
  ));
  setState({
    message: 'Draft could not be synced',
    failed: true,
    action: 'retry',
    canKeepEditing: false,
  });
  vi.advanceTimersByTime(10_000);
  expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined();
  setState(saved('1'));
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(screen.getByText('Draft saved').getAttribute('aria-hidden')).toBe(
    'false'
  );
  vi.advanceTimersByTime(2_000);
  expect(screen.getByText('Draft saved').getAttribute('aria-hidden')).toBe(
    'true'
  );
  cleanup();
  expect(vi.getTimerCount()).toBe(0);
});
