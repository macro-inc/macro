/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamInviteLinkSection } from './TeamInviteLinkSection';

const link = vi.hoisted(() => ({
  token: null as string | null,
  // Undefined data with no pending load: the first fetch failed.
  loadFailed: false,
  refetch: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  copied: [] as string[],
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn() },
}));
vi.mock('@core/util/webOrigin', () => ({
  getWebOrigin: () => 'https://macro.com',
}));
vi.mock('@core/util/dataTransfer', () => ({
  writeClipboardData: async (data: Record<string, string>) => {
    link.copied.push(data['text/plain']);
    return true;
  },
}));
vi.mock('@queries/team/invite-link', () => ({
  useTeamInviteLinkQuery: () => ({
    isPending: false,
    get data() {
      return link.loadFailed ? undefined : { token: link.token };
    },
    refetch: link.refetch,
  }),
  useCreateTeamInviteLinkMutation: () => ({
    isPending: false,
    mutate: link.create,
  }),
  useDeleteTeamInviteLinkMutation: () => ({
    isPending: false,
    mutate: link.remove,
  }),
}));

let motionStyles: HTMLStyleElement;
beforeEach(() => {
  link.token = null;
  link.loadFailed = false;
  link.refetch.mockReset();
  link.refetch.mockResolvedValue(undefined);
  link.copied = [];
  link.create.mockReset();
  link.remove.mockReset();
  motionStyles = document.createElement('style');
  // jsdom never fires animation events, so presence would keep closed dialogs mounted.
  motionStyles.textContent =
    '* { transition-duration: 0s; animation-name: none; }';
  document.head.append(motionStyles);
});

afterEach(() => {
  cleanup();
  motionStyles.remove();
});

describe('TeamInviteLinkSection', () => {
  it('creates the first link for anyone who may invite', () => {
    render(() => <TeamInviteLinkSection teamId="team-1" canManage={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Create link' }));

    expect(link.create).toHaveBeenCalledWith({ teamId: 'team-1' });
    expect(screen.queryByRole('button', { name: 'Reset link' })).toBeNull();
  });

  it('copies the join page for an existing link', async () => {
    link.token = 'abc-123';
    render(() => <TeamInviteLinkSection teamId="team-1" canManage={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    await vi.waitFor(() =>
      expect(link.copied).toEqual([
        'https://macro.com/app/team-invite?link=abc-123',
      ])
    );
    expect(link.create).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Turn off' })).toBeNull();
  });

  it('offers a retry, not a reset, when the link never loaded', () => {
    link.loadFailed = true;
    render(() => <TeamInviteLinkSection teamId="team-1" canManage />);

    expect(screen.queryByRole('button', { name: 'Create link' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(link.refetch).toHaveBeenCalled();
    expect(link.create).not.toHaveBeenCalled();
  });

  it('lets admins reset the link after confirming', async () => {
    link.token = 'abc-123';
    render(() => <TeamInviteLinkSection teamId="team-1" canManage />);

    fireEvent.click(screen.getByRole('button', { name: 'Reset link' }));
    expect(link.create).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog');
    const confirm = [...dialog.querySelectorAll('button')].find(
      (button) => button.textContent === 'Reset link'
    );
    fireEvent.click(confirm!);

    expect(link.create).toHaveBeenCalledWith({ teamId: 'team-1' });
  });

  it('lets admins turn the link off after confirming', async () => {
    link.token = 'abc-123';
    render(() => <TeamInviteLinkSection teamId="team-1" canManage />);

    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = [...dialog.querySelectorAll('button')].find(
      (button) => button.textContent === 'Turn off'
    );
    fireEvent.click(confirm!);

    expect(link.remove).toHaveBeenCalledWith({ teamId: 'team-1' });
  });
});
