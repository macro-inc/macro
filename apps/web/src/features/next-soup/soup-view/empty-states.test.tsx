/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState, shouldShowLoadError } from './empty-states';

vi.mock('@app/features/command/Launcher', () => ({
  useCreateAction: () => vi.fn(),
  useCreatableEnabled: () => () => true,
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
vi.mock('@ui/components/Hotkey', () => ({
  getNormalizedKeyString: () => '⌘K',
}));
vi.mock('./FolderDropZone', () => ({ FolderDropZone: () => null }));
vi.mock('./soup-view-context', () => ({
  useSoupView: () => ({ activeTab: () => undefined, searchText: () => '' }),
}));

describe('shouldShowLoadError', () => {
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
});

describe('Search empty state', () => {
  it('points to the command menu while Search waits for input', () => {
    render(() => <EmptyState listView="search" />);
    expect(screen.getByRole('status').textContent).toContain(
      'Press ⌘K to jump to anything or run a command.'
    );
  });
});
