/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { LoadErrorState, shouldShowLoadError } from './empty-states';

vi.mock('@app/features/command/Launcher', () => ({
  runCreateAction: vi.fn(),
}));
vi.mock('@channel/CreateChannelModal', () => ({
  openNewChannelModal: vi.fn(),
}));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({ openSettings: vi.fn() }),
}));
vi.mock('@core/email-link', () => ({
  useAddInboxFlow: () => vi.fn(),
  useEmailLinksStatus: () => () => false,
}));
vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({ data: undefined }),
  useIsTeamAdmin: () => () => false,
}));
vi.mock('./FolderDropZone', () => ({ FolderDropZone: () => null }));
vi.mock('./soup-view-context', () => ({
  useSoupView: () => ({ activeTab: () => undefined, searchText: () => '' }),
}));

describe('LoadErrorState', () => {
  it('replaces stale rendered rows when the active query has no data', () => {
    expect(
      shouldShowLoadError({
        hasData: false,
        forceEmptyState: false,
      })
    ).toBe(true);
    expect(
      shouldShowLoadError({
        hasData: true,
        forceEmptyState: false,
      })
    ).toBe(false);
    expect(
      shouldShowLoadError({
        hasData: false,
        forceEmptyState: true,
      })
    ).toBe(false);
  });

  it('distinguishes a failed load from an empty view and allows retrying', () => {
    const retry = vi.fn();

    render(() => <LoadErrorState onRetry={retry} />);

    expect(screen.getByText('Unable to load this view')).toBeTruthy();
    expect(
      screen.getByText('Check your internet connection and try again.')
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
