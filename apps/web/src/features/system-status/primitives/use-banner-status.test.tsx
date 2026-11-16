/**
 * @vitest-environment jsdom
 */

import type { CurrentSystemStatus } from '@queries/system-status/status';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusBanner } from '../components/StatusBanner';
import { useBannerStatus } from './use-banner-status';

const DISMISSED_STORAGE_KEY = 'macro:system-status:dismissed';

const [query, setQuery] = createStore<{
  isPending: boolean;
  data: CurrentSystemStatus | undefined;
}>({ isPending: false, data: undefined });

vi.mock('@queries/system-status/status', () => ({
  useCurrentSystemStatusQuery: () => query,
}));

function Harness() {
  const { status, dismiss } = useBannerStatus();
  return (
    <Show when={status()}>
      {(s) => <StatusBanner {...s()} onDismiss={dismiss} />}
    </Show>
  );
}

function degraded(id: string, message: string): CurrentSystemStatus {
  return { status: 'degraded', id, message };
}

/** Renders the banner as a fresh page load would. */
function reload() {
  cleanup();
  render(() => <Harness />);
}

beforeEach(() => {
  localStorage.clear();
  setQuery({ isPending: false, data: undefined });
});

afterEach(cleanup);

describe('useBannerStatus', () => {
  it('keeps a dismissed alert hidden after a reload', () => {
    setQuery({ data: degraded('alert-1', 'Slow search') });
    render(() => <Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).toBeNull();

    reload();
    expect(screen.queryByRole('status')).toBeNull();
    expect(localStorage.getItem(DISMISSED_STORAGE_KEY)).toBe('alert-1');
  });

  it('shows a new alert, even with the same message, and clears the expired one', () => {
    setQuery({ data: degraded('alert-1', 'Slow search') });
    render(() => <Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    setQuery({ data: degraded('alert-2', 'Slow search') });
    expect(screen.getByRole('status').textContent).toContain('Slow search');
    expect(localStorage.getItem(DISMISSED_STORAGE_KEY)).toBeNull();
  });

  it('clears the dismissal once the status is operational again', () => {
    setQuery({ data: degraded('alert-1', 'Slow search') });
    render(() => <Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    setQuery({ data: { status: 'operational', id: 'alert-2' } });
    expect(localStorage.getItem(DISMISSED_STORAGE_KEY)).toBeNull();
  });

  it('keeps the dismissal while the status is loading or failed to load', () => {
    localStorage.setItem(DISMISSED_STORAGE_KEY, 'alert-1');
    setQuery({ isPending: true, data: undefined });
    render(() => <Harness />);
    expect(localStorage.getItem(DISMISSED_STORAGE_KEY)).toBe('alert-1');

    setQuery({ isPending: false, data: undefined });
    expect(localStorage.getItem(DISMISSED_STORAGE_KEY)).toBe('alert-1');

    setQuery({ data: degraded('alert-1', 'Slow search') });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
