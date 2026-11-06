/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import type { JSX } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserCardTrigger } from './UserCardTrigger';

const mocks = vi.hoisted(() => ({
  isTouchDevice: false,
  openUserCard: vi.fn(),
}));

vi.mock('@core/user', () => ({
  tryMacroId: (id: string | undefined) => id,
  isAgentAccount: (id: string | undefined) => id === 'macro|agent@example.com',
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
    triggerOnContextMenu?: (event: MouseEvent) => void;
    content?: JSX.Element;
    open?: boolean;
  }) => (
    <span data-testid="hover-card" onContextMenu={props.triggerOnContextMenu}>
      {props.trigger}
      {props.open && props.content}
    </span>
  ),
}));

const jane = {
  displayName: 'Jane Doe',
  email: 'jane.doe@example.com',
  id: 'macro|jane.doe@example.com',
};

beforeEach(() => {
  mocks.isTouchDevice = false;
  mocks.openUserCard.mockReset();
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

it('opens an agent card on right-click without opening the phone drawer', () => {
  render(() => (
    <UserCardTrigger
      user={{ displayName: 'Assistant', id: 'macro|agent@example.com' }}
      trigger={<span>Agent portrait</span>}
    />
  ));
  fireEvent.contextMenu(screen.getByText('Agent portrait'));
  expect(screen.getByTestId('user-tooltip').textContent).toBe('Assistant');
  expect(mocks.openUserCard).not.toHaveBeenCalled();
});

it.each([true, false])(
  'reserves long-press only for agents (agent=%s)',
  (agent) => {
    mocks.isTouchDevice = true;
    vi.useFakeTimers();
    try {
      render(() => (
        <UserCardTrigger
          user={
            agent
              ? { displayName: 'Assistant', id: 'macro|agent@example.com' }
              : jane
          }
          trigger={<span>Portrait</span>}
        />
      ));
      const trigger = screen.getByRole('button');
      fireEvent.touchStart(trigger, {
        touches: [{ clientX: 10, clientY: 10 }],
      });
      vi.advanceTimersByTime(500);
      expect(mocks.openUserCard).toHaveBeenCalledTimes(agent ? 1 : 0);
      expect(fireEvent.touchEnd(trigger, { touches: [] })).toBe(!agent);
    } finally {
      vi.useRealTimers();
    }
  }
);
