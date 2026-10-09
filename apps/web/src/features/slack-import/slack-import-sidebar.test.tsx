import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hideSlackImportPromotion } from './primitives/promotion';
import { SlackImportSidebar } from './slack-import-sidebar';

const [userId, setUserId] = createSignal('');
const [teamId, setTeamId] = createSignal('');
let scope = 0;
const host = vi.hoisted(() => ({ enabled: true, admin: true }));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: host.enabled }),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => userId }));
vi.mock('@queries/team/teams', () => ({
  useIsTeamAdmin: () => () => host.admin,
  useCurrentTeamQuery: () => ({
    isSuccess: true,
    get data() {
      return { team: { id: teamId() } };
    },
  }),
}));
vi.mock('@ui', () => ({
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
vi.mock('./slack-import', () => ({
  SlackImport: (props: { trigger: (open: () => void) => JSX.Element }) => (
    <>
      {props.trigger(() => {})}
      <p>Import dialog host</p>
    </>
  ),
}));

beforeEach(() => {
  scope += 1;
  setUserId(`sidebar-user-${scope}`);
  setTeamId(`sidebar-team-${scope}`);
  host.enabled = true;
  host.admin = true;
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('Slack import sidebar', () => {
  it('dismisses, stays dismissed after remount, and retains the import host', () => {
    const view = render(() => <SlackImportSidebar />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss Slack import' })
    );
    expect(
      screen.queryByRole('button', { name: 'Import from Slack' })
    ).toBeNull();
    expect(screen.getByText('Import dialog host')).toBeTruthy();
    view.unmount();
    render(() => <SlackImportSidebar />);
    expect(screen.queryByText('Bring Slack to Macro')).toBeNull();
    setTeamId('another-team');
    expect(
      screen.getByRole('button', { name: 'Import from Slack' })
    ).toBeTruthy();
    setTeamId(`sidebar-team-${scope}`);
    setUserId('another-user');
    expect(
      screen.getByRole('button', { name: 'Import from Slack' })
    ).toBeTruthy();
  });

  it('hides immediately after completion without unmounting import progress', () => {
    render(() => <SlackImportSidebar />);
    hideSlackImportPromotion(userId(), teamId());
    expect(screen.queryByText('Bring Slack to Macro')).toBeNull();
    expect(screen.getByText('Import dialog host')).toBeTruthy();
  });

  it.each([
    { enabled: false, admin: true },
    { enabled: true, admin: false },
  ])('preserves the feature and admin gates: %o', (gate) => {
    Object.assign(host, gate);
    render(() => <SlackImportSidebar />);
    expect(screen.queryByText('Bring Slack to Macro')).toBeNull();
  });
});
