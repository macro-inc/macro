/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDeleteMessageConfirmation } from '../create-delete-message-confirmation';

vi.mock('@phosphor-icons/core/regular/x.svg?component-solid', () => ({
  default: () => <span data-testid="close-icon" />,
}));

const deleteInput = {
  parent: { type: 'channel' as const, id: 'channel-1' },
  messageID: 'message-1',
  threadID: 'thread-1',
};

describe('createDeleteMessageConfirmation', () => {
  it('does not delete until the dialog is confirmed', async () => {
    const deleteMessage = vi.fn();
    const { requestDelete, ConfirmationDialog } =
      createDeleteMessageConfirmation(deleteMessage);

    render(() => <ConfirmationDialog />);

    requestDelete(deleteInput);
    await screen.findByText('Delete message');
    expect(deleteMessage).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(deleteMessage).toHaveBeenCalledTimes(1);
    expect(deleteMessage).toHaveBeenCalledWith(deleteInput);
  });

  it('does not delete when the dialog is cancelled', async () => {
    const deleteMessage = vi.fn();
    const { requestDelete, ConfirmationDialog } =
      createDeleteMessageConfirmation(deleteMessage);

    render(() => <ConfirmationDialog />);

    requestDelete(deleteInput);
    await screen.findByText('Delete message');

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(deleteMessage).not.toHaveBeenCalled();
  });

  it('warns that a discussion root takes its replies with it', async () => {
    const { requestDelete, ConfirmationDialog } =
      createDeleteMessageConfirmation(vi.fn());

    render(() => <ConfirmationDialog />);

    requestDelete({
      parent: { type: 'document', id: 'doc-1' },
      messageID: 'root-1',
    });
    await screen.findByText('Delete comment');
    expect(
      screen.getByText(
        'This comment and every reply to it will be permanently deleted. This action cannot be undone.'
      )
    ).toBeTruthy();
  });

  it('keeps the message-only warning for a reply', async () => {
    const { requestDelete, ConfirmationDialog } =
      createDeleteMessageConfirmation(vi.fn());

    render(() => <ConfirmationDialog />);

    requestDelete({
      parent: { type: 'document', id: 'doc-1' },
      messageID: 'reply-1',
      threadID: 'root-1',
    });
    await screen.findByText('Delete message');
  });
});
