/**
 * @vitest-environment jsdom
 */

import { toast } from '@core/component/Toast/Toast';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserTooltip } from './UserTooltip';

const mocks = vi.hoisted(() => ({
  crmFlagEnabled: true,
  teamCrmEnabled: true as boolean | null,
  contact: { id: 'contact-1' } as { id: string } | null | undefined,
  openWithSplit: vi.fn(),
  onClose: vi.fn(),
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({
    enabled: mocks.crmFlagEnabled,
    payload: undefined,
  }),
}));

vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({
    openWithSplit: mocks.openWithSplit,
    popoverSplit: vi.fn(),
  }),
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn(), success: vi.fn() },
}));

vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|current@example.com',
}));

vi.mock('@core/user', () => ({
  useIsConnectedSecondaryInbox: () => () => false,
}));

vi.mock('@queries/channel/get-or-create-dm', () => ({
  useGetOrCreateDirectMessageMutation: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@queries/crm/contacts', () => ({
  useCrmContactByEmailQuery: () => ({
    get data() {
      return mocks.contact;
    },
  }),
}));

vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({
    get data() {
      if (mocks.teamCrmEnabled === null) return null;
      return { team: { crm_enabled: mocks.teamCrmEnabled } };
    },
  }),
}));

vi.mock('@ui', () => ({
  cn: (...classes: Array<string | undefined>) =>
    classes.filter(Boolean).join(' '),
  Surface: (props: { children: JSX.Element; class?: string }) => (
    <div class={props.class}>{props.children}</div>
  ),
}));

vi.mock('./UserIcon', () => ({
  UserIcon: () => <div data-testid="user-icon" />,
}));

const writeText = vi.fn();

afterEach(cleanup);

beforeEach(() => {
  mocks.crmFlagEnabled = true;
  mocks.teamCrmEnabled = true;
  mocks.contact = { id: 'contact-1' };
  mocks.openWithSplit.mockReset();
  mocks.onClose.mockReset();
  writeText.mockReset();
  vi.mocked(toast.success).mockReset();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

describe('UserTooltip CRM contact action', () => {
  it('opens the CRM contact resolved for the hovered email', async () => {
    const user = userEvent.setup({ skipHover: true });
    render(() => (
      <UserTooltip
        displayName="Jane Doe"
        email="jane.doe@example.com"
        id="macro|jane.doe@example.com"
        onClose={mocks.onClose}
      />
    ));

    await user.click(
      await screen.findByRole('button', { name: 'Open contact' })
    );

    expect(mocks.openWithSplit).toHaveBeenCalledWith(
      { type: 'contact', id: 'contact-1' },
      { preferNewSplit: false, reopen: 'latest' }
    );
    expect(mocks.onClose).toHaveBeenCalledOnce();
  });

  it('hides the contact action when the CRM feature flag is off', () => {
    mocks.crmFlagEnabled = false;

    render(() => (
      <UserTooltip displayName="Jane Doe" email="jane.doe@example.com" />
    ));

    expect(screen.queryByRole('button', { name: 'Open contact' })).toBeNull();
  });

  it('hides the contact action when CRM is disabled for the team', () => {
    mocks.teamCrmEnabled = false;

    render(() => (
      <UserTooltip displayName="Jane Doe" email="jane.doe@example.com" />
    ));

    expect(screen.queryByRole('button', { name: 'Open contact' })).toBeNull();
  });

  it('hides the contact action when the user has no team', () => {
    mocks.teamCrmEnabled = null;

    render(() => (
      <UserTooltip displayName="Jane Doe" email="jane.doe@example.com" />
    ));

    expect(screen.queryByRole('button', { name: 'Open contact' })).toBeNull();
  });

  it('hides the contact action when no CRM contact exists', () => {
    mocks.contact = null;

    render(() => (
      <UserTooltip displayName="Jane Doe" email="jane.doe@example.com" />
    ));

    expect(screen.queryByRole('button', { name: 'Open contact' })).toBeNull();
  });

  it('keeps the rest of the tooltip visible while the contact is loading', () => {
    mocks.contact = undefined;

    render(() => (
      <UserTooltip
        displayName="Jane Doe"
        email="jane.doe@example.com"
        id="macro|jane.doe@example.com"
      />
    ));

    expect(screen.getByText('Jane Doe')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy email' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open contact' })).toBeNull();
  });
});

describe('UserTooltip copy actions', () => {
  it('copies the displayed name, toasts Name copied, and does not close', () => {
    render(() => (
      <UserTooltip
        displayName="Jane Doe"
        email="jane.doe@example.com"
        onClose={mocks.onClose}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Copy name' }));

    expect(writeText).toHaveBeenCalledWith('Jane Doe');
    expect(toast.success).toHaveBeenCalledWith('Name copied');
    expect(mocks.onClose).not.toHaveBeenCalled();
  });

  it('copies email only, toasts Email copied, and does not close', () => {
    render(() => (
      <UserTooltip
        displayName="Jane Doe"
        email="jane.doe@example.com"
        onClose={mocks.onClose}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Copy email' }));

    expect(writeText).toHaveBeenCalledWith('jane.doe@example.com');
    expect(writeText).not.toHaveBeenCalledWith('Jane Doe');
    expect(toast.success).toHaveBeenCalledWith('Email copied');
    expect(mocks.onClose).not.toHaveBeenCalled();
  });

  it('hides Copy name for Me / me', () => {
    const { unmount } = render(() => (
      <UserTooltip displayName="Me" email="me@example.com" />
    ));
    expect(screen.queryByRole('button', { name: 'Copy name' })).toBeNull();
    unmount();

    render(() => <UserTooltip displayName="me" email="me@example.com" />);
    expect(screen.queryByRole('button', { name: 'Copy name' })).toBeNull();
  });

  it('hides Copy name when displayName equals email', () => {
    render(() => (
      <UserTooltip
        displayName="jane.doe@example.com"
        email="jane.doe@example.com"
      />
    ));

    expect(screen.queryByRole('button', { name: 'Copy name' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy email' })).toBeTruthy();
  });

  it('hides Copy name when displayName equals the email local-part', () => {
    render(() => (
      <UserTooltip displayName="jane.doe" email="jane.doe@example.com" />
    ));

    expect(screen.queryByRole('button', { name: 'Copy name' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy email' })).toBeTruthy();
  });

  it('hides Copy name when displayName is blank', () => {
    render(() => (
      <UserTooltip displayName="   " email="jane.doe@example.com" />
    ));

    expect(screen.queryByRole('button', { name: 'Copy name' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy email' })).toBeTruthy();
  });

  it('shows Copy name when there is a real name and no email', () => {
    render(() => <UserTooltip displayName="Jane Doe" />);

    expect(screen.getByRole('button', { name: 'Copy name' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy email' })).toBeNull();
  });
});
