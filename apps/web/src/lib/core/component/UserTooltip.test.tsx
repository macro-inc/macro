/**
 * @vitest-environment jsdom
 */

import { agentSettingsRequest } from '@app/features/settings/agentSettingsState';
import { botSettingsRequest } from '@channel/Bots/botSettingsState';
import { render, screen, waitFor } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import type { JSX } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserTooltip } from './UserTooltip';

const mocks = vi.hoisted(() => ({
  crmFlagEnabled: true,
  teamCrmEnabled: true as boolean | null,
  contact: { id: 'contact-1' } as { id: string } | null | undefined,
  openWithSplit: vi.fn(),
  onClose: vi.fn(),
  toastSuccess: vi.fn(),
  toastFailure: vi.fn(),
  openSettings: vi.fn(),
  agents: [] as Array<{
    bot: {
      id: string;
      owner:
        | { type: 'team'; team_id: string }
        | { type: 'user'; user_id: string };
    };
  }>,
  bots: [] as Array<{ id: string }>,
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: { key: string }) => () => ({
    enabled: flag.key === 'enable-crm' ? mocks.crmFlagEnabled : true,
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
  toast: { failure: mocks.toastFailure, success: mocks.toastSuccess },
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

vi.mock('@app/features/crm/record-adapter', () => ({
  useCrmContactByEmailQuery: () => ({
    // Pending lookups report no data yet, exactly as solid-query does.
    get isSuccess() {
      return mocks.contact !== undefined;
    },
    get data() {
      return mocks.contact;
    },
  }),
}));

vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({
    isSuccess: true,
    get data() {
      if (mocks.teamCrmEnabled === null) return null;
      return { team: { id: 'team-1', crm_enabled: mocks.teamCrmEnabled } };
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

vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({ openSettings: mocks.openSettings }),
}));

vi.mock('@queries/agents/agents', () => ({
  useAgentsQuery: () => ({ isSuccess: true, data: mocks.agents }),
}));

vi.mock('@queries/bots/bots', () => ({
  useBotsQuery: () => ({ isSuccess: true, data: mocks.bots }),
}));

vi.mock('./UserIcon', () => ({
  UserIcon: () => <div data-testid="user-icon" />,
}));

beforeEach(() => {
  mocks.crmFlagEnabled = true;
  mocks.teamCrmEnabled = true;
  mocks.contact = { id: 'contact-1' };
  mocks.openWithSplit.mockReset();
  mocks.onClose.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastFailure.mockReset();
  mocks.openSettings.mockReset();
  mocks.agents = [];
  mocks.bots = [];
});

describe('UserTooltip clipboard action', () => {
  it('shows the copied icon only after the clipboard resolves', async () => {
    const user = userEvent.setup({ skipHover: true });
    let finishCopy!: () => void;
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishCopy = resolve;
        })
    );
    render(() => (
      <UserTooltip displayName="Jane Doe" onClose={mocks.onClose} />
    ));
    const button = screen.getByRole('button', { name: 'Copy name' });
    const copyIcon = button.querySelector('svg');

    await user.click(button);
    expect(button.querySelector('svg')).toBe(copyIcon);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();

    finishCopy();
    await waitFor(() => {
      expect(button.querySelector('svg')).not.toBe(copyIcon);
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Name copied');
    });
    expect(mocks.onClose).not.toHaveBeenCalled();
  });

  it('leaves the copy icon and card open after a clipboard rejection', async () => {
    const user = userEvent.setup({ skipHover: true });
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(
      new Error('Clipboard denied')
    );
    render(() => (
      <UserTooltip displayName="Jane Doe" onClose={mocks.onClose} />
    ));
    const button = screen.getByRole('button', { name: 'Copy name' });
    const copyIcon = button.querySelector('svg');

    await user.click(button);

    expect(button.querySelector('svg')).toBe(copyIcon);
    expect(mocks.toastFailure).toHaveBeenCalledWith(
      'Failed to copy to clipboard'
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.onClose).not.toHaveBeenCalled();
  });
});

describe('UserTooltip direct message action', () => {
  it('offers a DM for another person', () => {
    render(() => (
      <UserTooltip
        displayName="Jane Doe"
        email="jane.doe@example.com"
        id="macro|jane.doe@example.com"
      />
    ));

    expect(screen.getByRole('button', { name: 'DM' })).toBeTruthy();
  });

  it('offers no DM for an agent, which is mentioned rather than messaged', () => {
    render(() => (
      <UserTooltip
        displayName="Cursor"
        email="Cursor"
        id="bot|00000000-0000-0000-0000-00000000c5c5"
      />
    ));

    expect(screen.queryByRole('button', { name: 'DM' })).toBeNull();
    // The rest of the card is untouched: an agent still hovers like a person.
    expect(screen.getByText('Cursor')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Assign task' })).toBeTruthy();
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

describe('UserTooltip settings action', () => {
  const agentId = '0190f3a1-0000-7000-8000-00000000a9e1';

  it("opens a team agent's editor in Settings", async () => {
    const user = userEvent.setup({ skipHover: true });
    mocks.agents = [
      { bot: { id: agentId, owner: { type: 'team', team_id: 'team-1' } } },
    ];
    render(() => (
      <UserTooltip
        displayName="Researcher"
        id={`bot|${agentId}`}
        onClose={mocks.onClose}
      />
    ));

    await user.click(screen.getByRole('button', { name: 'Settings' }));

    expect(mocks.openSettings).toHaveBeenCalledWith('Agents');
    expect(agentSettingsRequest()?.agentId).toBe(agentId);
    expect(mocks.onClose).toHaveBeenCalledOnce();
  });

  it("opens a bot's page under Bots when it is not an agent", async () => {
    const user = userEvent.setup({ skipHover: true });
    mocks.bots = [{ id: agentId }];
    render(() => (
      <UserTooltip displayName="Deploy bot" id={`bot|${agentId}`} />
    ));

    await user.click(screen.getByRole('button', { name: 'Settings' }));

    expect(mocks.openSettings).toHaveBeenCalledWith('Bots');
    expect(botSettingsRequest()).toMatchObject({
      type: 'detail',
      botId: agentId,
    });
  });

  it('opens the Agents list for Macro', async () => {
    const user = userEvent.setup({ skipHover: true });
    render(() => (
      <UserTooltip
        displayName="Macro"
        id="bot|00000000-0000-0000-0000-00000000a1a1"
      />
    ));

    await user.click(screen.getByRole('button', { name: 'Settings' }));

    expect(mocks.openSettings).toHaveBeenCalledWith('Agents');
  });

  it("offers no settings for another user's private agent", () => {
    mocks.agents = [
      {
        bot: {
          id: agentId,
          owner: { type: 'user', user_id: 'macro|someone@example.com' },
        },
      },
    ];
    mocks.bots = [{ id: agentId }];
    render(() => <UserTooltip displayName="Theirs" id={`bot|${agentId}`} />);

    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
  });

  it('offers no settings for a person', () => {
    render(() => (
      <UserTooltip
        displayName="Jane Doe"
        email="jane.doe@example.com"
        id="macro|jane.doe@example.com"
      />
    ));

    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
  });
});
