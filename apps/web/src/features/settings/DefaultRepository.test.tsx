import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPreferredRepository } from '../agents-view/primitives/preferred-repository';
import { DefaultRepository } from './DefaultRepository';
import { chooseSelectOption } from './tests/select-helpers';

const mocks = vi.hoisted(() => ({
  loading: false,
  error: false,
  repositories: [
    { url: 'https://github.com/macro-inc/macro', defaultBranch: 'main' },
  ],
  retry: vi.fn(),
  openSettings: vi.fn(),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user' }));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({ openSettings: mocks.openSettings }),
}));
vi.mock('@queries/agent-repositories/repositories', () => ({
  useAgentRepositoriesQuery: () => ({
    get isSuccess() {
      return !mocks.loading && !mocks.error;
    },
    get isLoading() {
      return mocks.loading;
    },
    get isError() {
      return mocks.error;
    },
    get data() {
      if (mocks.loading || mocks.error)
        throw new Error('Unguarded query data read');
      return { repositories: mocks.repositories };
    },
    refetch: mocks.retry,
  }),
}));

beforeEach(() => {
  localStorage.clear();
  mocks.loading = false;
  mocks.error = false;
  mocks.repositories = [
    { url: 'https://github.com/macro-inc/macro', defaultBranch: 'main' },
  ];
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('default repository settings', () => {
  it('defaults to Auto-detect and persists choices including returning to auto', () => {
    render(() => <DefaultRepository />);
    const select = screen.getByRole('button', { name: /^Default repository/ });
    expect(select.textContent).toContain('Auto-detect');
    chooseSelectOption(select, 'macro-inc/macro');
    createRoot((dispose) => {
      expect(createPreferredRepository('user').repository()).toBe(
        'https://github.com/macro-inc/macro'
      );
      dispose();
    });
    cleanup();
    render(() => <DefaultRepository />);
    const restored = screen.getByRole('button', {
      name: /^Default repository/,
    });
    expect(restored.textContent).toContain('macro-inc/macro');
    chooseSelectOption(restored, 'Auto-detect');
    createRoot((dispose) => {
      expect(createPreferredRepository('user').repository()).toBeUndefined();
      dispose();
    });
  });

  it('keeps the setting visible while repositories load', () => {
    mocks.loading = true;
    render(() => <DefaultRepository />);
    expect(
      screen.getByRole('button', { name: /^Default repository/ }).textContent
    ).toContain('Auto-detect');
    expect(screen.getByRole('status').textContent).toContain('Loading');
  });

  it('offers retry on failure and GitHub connection when no repositories are available', () => {
    mocks.error = true;
    render(() => <DefaultRepository />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.retry).toHaveBeenCalledOnce();
    cleanup();
    mocks.error = false;
    mocks.repositories = [];
    render(() => <DefaultRepository />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }));
    expect(mocks.openSettings).toHaveBeenCalledWith('Connected');
  });

  it('explains when a saved repository is no longer accessible', () => {
    createRoot((dispose) => {
      createPreferredRepository('user').select(
        'https://github.com/removed/repo'
      );
      dispose();
    });
    render(() => <DefaultRepository />);
    expect(
      screen.getByRole('button', { name: /^Default repository/ }).textContent
    ).toContain('removed/repo (unavailable)');
    expect(screen.getByRole('status').textContent).toContain('Auto-detect');
  });
});
