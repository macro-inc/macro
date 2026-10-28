/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelInviteModal } from './channel-invite-modal';

// The shared picker has app providers; these tests exercise modal choice and
// submission behavior. The real picker is used in the live app verification.
vi.mock('@core/component/RecipientSelector', () => ({
  RecipientSelector: () => <input aria-label="People picker" />,
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(team = true) {
  const onAdd = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(() => (
    <ChannelInviteModal
      channelName="Design"
      team={
        team
          ? { name: 'Acme', memberIds: ['existing', 'new-member'] }
          : undefined
      }
      teamLoading={false}
      teamError={false}
      participantsReady
      participantIds={['existing']}
      options={() => []}
      onAdd={onAdd}
      onClose={onClose}
    />
  ));
  return { onAdd, onClose };
}

describe('channel invite modal', () => {
  it('switches between the team option and the specific people picker', async () => {
    const { onAdd, onClose } = setup();
    await screen.findByRole('dialog', { name: 'Invite people to Design' });
    expect(screen.getByRole('textbox', { name: 'People picker' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Add all members of Acme'));
    expect(screen.queryByRole('textbox', { name: 'People picker' })).toBeNull();
    expect(onAdd).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Add specific people'));
    expect(screen.getByRole('textbox', { name: 'People picker' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('submits current teammates after choosing the team option and clicking Add', async () => {
    const { onAdd, onClose } = setup();
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByLabelText('Add all members of Acme'));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onAdd).toHaveBeenCalledWith(['new-member']);
  });

  it('keeps individual invitations available without a team', async () => {
    setup(false);
    await screen.findByRole('dialog');
    expect(
      screen.getByLabelText('Add all members of your team')
    ).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('Add specific people')).toHaveProperty(
      'checked',
      true
    );
    expect(screen.getByRole('textbox', { name: 'People picker' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add' })).toHaveProperty(
      'disabled',
      true
    );
  });
});
