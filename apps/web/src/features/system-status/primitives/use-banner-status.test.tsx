/**
 * @vitest-environment jsdom
 */

import type { CurrentSystemStatus } from '@queries/system-status/status';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StatusBanner } from '../components/StatusBanner';
import { useBannerStatus } from './use-banner-status';

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

afterEach(cleanup);

describe('useBannerStatus', () => {
  it('hides a dismissed banner and shows the next one', () => {
    setQuery({ data: { status: 'degraded', message: 'Slow search' } });
    render(() => <Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).toBeNull();

    setQuery({ data: { status: 'degraded', message: 'Email delayed' } });
    expect(screen.getByRole('status').textContent).toContain('Email delayed');
  });

  it('shows the same message again once its level changes', () => {
    setQuery({ data: { status: 'degraded', message: 'Sync is down' } });
    render(() => <Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).toBeNull();

    setQuery({ data: { status: 'major_outage', message: 'Sync is down' } });
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
