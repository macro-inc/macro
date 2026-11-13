/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import type { JSX } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserCardTrigger } from './UserCardTrigger';

const mocks = vi.hoisted(() => ({
  isTouchDevice: false,
  openUserCard: vi.fn(),
  openWithSplit: vi.fn(),
  agentDashboards: true,
  agents: new Set(['macro|agent@example.com']),
}));

vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/featureFlags')>()),
  isFeatureEnabled: (flag: { key?: string }) =>
    flag.key === 'enable-agent-dashboards' && mocks.agentDashboards,
}));

vi.mock('@core/user', () => ({
  isAgentAccount: (id: string | undefined) => !!id && mocks.agents.has(id),
  tryMacroId: (id: string) => id,
}));

vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: mocks.openWithSplit }),
}));

vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.isTouchDevice,
}));

vi.mock('./UserCardDrawer', () => ({
  openUserCard: mocks.openUserCard,
}));

vi.mock('./UserTooltip', () => ({
  UserTooltip: (props: { displayName: string }) => (
    <div data-testid="user-tooltip">{props.displayName}</div>
  ),
}));

vi.mock('./HoverCard', () => ({
  HoverCard: (props: {
    trigger: JSX.Element;
    triggerOnClick?: (event: MouseEvent) => void;
  }) => (
    <span data-testid="hover-card" onClick={(e) => props.triggerOnClick?.(e)}>
      {props.trigger}
    </span>
  ),
}));

const jane = {
  displayName: 'Jane Doe',
  email: 'jane.doe@example.com',
  id: 'macro|jane.doe@example.com',
};

const agent = {
  displayName: 'Ops Agent',
  email: 'agent@example.com',
  id: 'macro|agent@example.com',
};

const agentProfile = expect.objectContaining({
  type: 'component',
  id: 'agent-dashboard',
  params: { userId: agent.id },
});

beforeEach(() => {
  mocks.isTouchDevice = false;
  mocks.agentDashboards = true;
  mocks.openUserCard.mockReset();
  mocks.openWithSplit.mockReset();
});

describe('UserCardTrigger', () => {
  it('hangs the card off a hover card where there is a pointer', async () => {
    const user = userEvent.setup({ skipHover: true });
    render(() => <UserCardTrigger user={jane} trigger={<span>@Jane</span>} />);

    expect(screen.getByTestId('hover-card')).toBeTruthy();

    await user.click(screen.getByText('@Jane'));

    expect(mocks.openUserCard).not.toHaveBeenCalled();
  });

  it('opens the card as a sheet when a touch device taps the trigger', async () => {
    mocks.isTouchDevice = true;
    const user = userEvent.setup({ skipHover: true });
    render(() => <UserCardTrigger user={jane} trigger={<span>@Jane</span>} />);

    expect(screen.queryByTestId('hover-card')).toBeNull();

    await user.click(screen.getByText('@Jane'));

    expect(mocks.openUserCard).toHaveBeenCalledWith(jane);
  });

  it('reads the person at tap time, so a late display name is not stale', async () => {
    mocks.isTouchDevice = true;
    const user = userEvent.setup({ skipHover: true });
    let displayName = '';
    render(() => (
      <UserCardTrigger
        user={{ displayName, id: jane.id }}
        trigger={<span>@Jane</span>}
      />
    ));

    displayName = 'Jane Doe';
    await user.click(screen.getByText('@Jane'));

    expect(mocks.openUserCard).toHaveBeenCalledWith({
      displayName: 'Jane Doe',
      id: jane.id,
    });
  });

  it.each(['{Enter}', ' '])('opens the touch card with %s', async (key) => {
    mocks.isTouchDevice = true;
    const user = userEvent.setup();
    render(() => <UserCardTrigger user={jane} trigger={<span>@Jane</span>} />);

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button'));
    await user.keyboard(key);

    expect(mocks.openUserCard).toHaveBeenCalledExactlyOnceWith(jane);
  });

  it('preserves an explicit touch trigger tab index', () => {
    mocks.isTouchDevice = true;
    render(() => (
      <UserCardTrigger
        user={jane}
        trigger={<span>@Jane</span>}
        triggerTabIndex={-1}
      />
    ));

    expect(screen.getByRole('button').tabIndex).toBe(-1);
  });
});

describe('UserCardTrigger on an agent teammate', () => {
  it("opens the agent's profile in a new pane on click", async () => {
    const user = userEvent.setup({ skipHover: true });
    render(() => (
      <UserCardTrigger
        user={agent}
        profileSurface="mention"
        trigger={<span>@Ops</span>}
      />
    ));

    await user.click(screen.getByText('@Ops'));

    expect(mocks.openWithSplit).toHaveBeenCalledExactlyOnceWith(agentProfile, {
      activate: true,
      preferNewSplit: true,
    });
    expect(mocks.openUserCard).not.toHaveBeenCalled();
  });

  it('opens the profile instead of the sheet on a touch tap', async () => {
    mocks.isTouchDevice = true;
    const user = userEvent.setup({ skipHover: true });
    render(() => (
      <UserCardTrigger
        user={agent}
        profileSurface="avatar"
        trigger={<span>@Ops</span>}
      />
    ));

    await user.click(screen.getByText('@Ops'));

    expect(mocks.openWithSplit).toHaveBeenCalledExactlyOnceWith(
      agentProfile,
      expect.anything()
    );
    expect(mocks.openUserCard).not.toHaveBeenCalled();
  });

  it('keeps the card for a person', async () => {
    mocks.isTouchDevice = true;
    const user = userEvent.setup({ skipHover: true });
    render(() => (
      <UserCardTrigger
        user={jane}
        profileSurface="avatar"
        trigger={<span>@Jane</span>}
      />
    ));

    await user.click(screen.getByText('@Jane'));

    expect(mocks.openUserCard).toHaveBeenCalledWith(jane);
    expect(mocks.openWithSplit).not.toHaveBeenCalled();
  });

  it('keeps the card with agent dashboards off', async () => {
    mocks.isTouchDevice = true;
    mocks.agentDashboards = false;
    const user = userEvent.setup({ skipHover: true });
    render(() => (
      <UserCardTrigger
        user={agent}
        profileSurface="avatar"
        trigger={<span>@Ops</span>}
      />
    ));

    await user.click(screen.getByText('@Ops'));

    expect(mocks.openUserCard).toHaveBeenCalledWith(agent);
    expect(mocks.openWithSplit).not.toHaveBeenCalled();
  });

  it('keeps the card where the trigger names no surface', async () => {
    const user = userEvent.setup({ skipHover: true });
    render(() => <UserCardTrigger user={agent} trigger={<span>@Ops</span>} />);

    await user.click(screen.getByText('@Ops'));

    expect(mocks.openWithSplit).not.toHaveBeenCalled();
  });
});
