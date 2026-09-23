/**
 * @vitest-environment jsdom
 */

import { render, screen, waitFor } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { type ComponentProps, type JSX, Show } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openUserCard, UserCardDrawer } from './UserCardDrawer';

const mocks = vi.hoisted(() => ({
  crmFlagEnabled: false,
  openWithSplit: vi.fn(),
  popoverSplit: vi.fn(),
  getOrCreateDm: vi.fn(),
  toastSuccess: vi.fn(),
  toastFailure: vi.fn(),
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
    popoverSplit: mocks.popoverSplit,
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
  useGetOrCreateDirectMessageMutation: () => ({
    mutateAsync: mocks.getOrCreateDm,
  }),
}));

vi.mock('@queries/crm/contacts', () => ({
  useCrmContactByEmailQuery: () => ({ isSuccess: false, data: undefined }),
}));

vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({ isSuccess: false, data: undefined }),
}));

vi.mock('./UserIcon', () => ({
  UserIcon: () => <div data-testid="user-icon" />,
}));

vi.mock('@components/app/mobile/MobileDrawer', () => {
  const Container = (props: { children?: JSX.Element }) => props.children;
  const Root = (props: { open?: boolean; children?: JSX.Element }) => (
    <Show when={props.open}>{props.children}</Show>
  );
  return {
    MobileDrawer: Object.assign(Root, {
      Portal: Container,
      Overlay: () => null,
      Content: Container,
      Handle: () => null,
      ScrollBody: Container,
      Section: Container,
      Item: (props: ComponentProps<'button'>) => (
        <button type="button" {...props} />
      ),
    }),
  };
});

beforeEach(() => {
  mocks.crmFlagEnabled = false;
  mocks.openWithSplit.mockReset();
  mocks.popoverSplit.mockReset();
  mocks.getOrCreateDm.mockReset().mockResolvedValue({ channel_id: 'chan-1' });
  mocks.toastSuccess.mockReset();
  mocks.toastFailure.mockReset();
});

function openJane() {
  openUserCard({
    displayName: 'Jane Doe',
    email: 'jane.doe@example.com',
    id: 'macro|jane.doe@example.com',
  });
}

describe('UserCardDrawer', () => {
  it('stays closed until a user card is opened', () => {
    render(() => <UserCardDrawer />);

    expect(screen.queryByText('Jane Doe')).toBeNull();
  });

  it('shows the tapped person and the actions of the hover card', () => {
    render(() => <UserCardDrawer />);
    openJane();

    expect(screen.getByText('Jane Doe')).toBeTruthy();
    expect(screen.getByText('jane.doe@example.com')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy email' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy name' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'DM' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Assign task' })).toBeTruthy();
  });

  it('opens a direct message and closes the sheet', async () => {
    const user = userEvent.setup({ skipHover: true });
    render(() => <UserCardDrawer />);
    openJane();

    await user.click(screen.getByRole('button', { name: 'DM' }));

    expect(mocks.getOrCreateDm).toHaveBeenCalledWith({
      recipient_id: 'macro|jane.doe@example.com',
    });
    expect(screen.queryByRole('button', { name: 'DM' })).toBeNull();
  });

  it('copies the email and closes the sheet, which a toast confirms', async () => {
    const user = userEvent.setup({ skipHover: true });
    render(() => <UserCardDrawer />);
    openJane();

    await user.click(screen.getByRole('button', { name: 'Copy email' }));

    expect(await navigator.clipboard.readText()).toBe('jane.doe@example.com');
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Email copied');
    expect(screen.queryByRole('button', { name: 'Copy email' })).toBeNull();
  });

  it('assigns a task to the tapped person', async () => {
    const user = userEvent.setup({ skipHover: true });
    render(() => <UserCardDrawer />);
    openJane();

    await user.click(screen.getByRole('button', { name: 'Assign task' }));

    expect(mocks.popoverSplit).toHaveBeenCalledWith({
      type: 'component',
      id: 'task-compose',
      params: { initialAssigneeIds: ['macro|jane.doe@example.com'] },
    });
  });

  it('waits for the clipboard before confirming and closing', async () => {
    const user = userEvent.setup({ skipHover: true });
    let finishCopy!: () => void;
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishCopy = resolve;
        })
    );
    render(() => <UserCardDrawer />);
    openJane();

    await user.click(screen.getByRole('button', { name: 'Copy email' }));
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Copy email' })).toBeTruthy();

    finishCopy();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Copy email' })).toBeNull();
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Email copied');
    });
  });

  it('keeps the sheet open and reports a failed clipboard write', async () => {
    const user = userEvent.setup({ skipHover: true });
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(
      new Error('Clipboard denied')
    );
    render(() => <UserCardDrawer />);
    openJane();

    await user.click(screen.getByRole('button', { name: 'Copy email' }));

    expect(mocks.toastFailure).toHaveBeenCalledWith(
      'Failed to copy to clipboard'
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Copy email' })).toBeTruthy();
  });

  it('offers no DM for an agent, which is mentioned rather than messaged', () => {
    render(() => <UserCardDrawer />);
    openUserCard({
      displayName: 'Cursor',
      email: 'Cursor',
      id: 'bot|00000000-0000-0000-0000-00000000c5c5',
    });

    expect(screen.queryByRole('button', { name: 'DM' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Assign task' })).toBeTruthy();
  });
});
