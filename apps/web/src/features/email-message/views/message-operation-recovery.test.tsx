import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { MessageOperation } from '../core/message-operation';
import { MessageOperationRecovery } from './message-operation-recovery';

afterEach(cleanup);

it.each([
  [
    'CONNECTION_UNAVAILABLE',
    'No message was submitted because the mail server connection failed. Try sending again.',
  ],
  [
    'PROVIDER_REJECTED',
    'The mail server refused this message. Check the recipient address and sender settings before trying again.',
  ],
  [
    undefined,
    'This message was not submitted. Review your mailbox settings before trying again.',
  ],
] as const)(
  'keeps a %s failure visible and requires a deliberate retry',
  async (reason, description) => {
    const operation: MessageOperation = {
      state: 'FAILED',
      issue: 'SEND_REJECTED',
      sendRejectionReason: reason,
      revision: '17',
    };
    const resolve = vi.fn(async () => {});
    render(() => (
      <MessageOperationRecovery
        source={{ operation: () => operation, resolve }}
      />
    ));
    const copy = screen.getByText(description);
    expect(copy.isConnected).toBe(true);
    expect(getComputedStyle(copy).display).not.toBe('none');
    expect(getComputedStyle(copy).visibility).not.toBe('hidden');
    expect(resolve).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Retry send' }));
    expect(resolve).toHaveBeenCalledExactlyOnceWith(
      operation,
      'retry_send',
      false
    );
  }
);

it('requires deliberate acknowledgement before retrying an uncertain send', async () => {
  const operation: MessageOperation = {
    state: 'UNCERTAIN',
    issue: 'SEND_UNKNOWN',
    revision: '9223372036854775000',
  };
  const resolve = vi.fn(async () => {});
  render(() => (
    <MessageOperationRecovery
      source={{ operation: () => operation, resolve }}
    />
  ));
  await fireEvent.click(screen.getByRole('button', { name: 'Retry send' }));
  expect(resolve).not.toHaveBeenCalled();
  const confirm = screen.getByRole('button', {
    name: 'Confirm',
  }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  await fireEvent.click(screen.getByRole('checkbox'));
  await fireEvent.click(confirm);
  expect(resolve).toHaveBeenCalledExactlyOnceWith(
    operation,
    'retry_send',
    true
  );
});

it('resolves the conflict version the user reviewed even if a newer version arrives', async () => {
  const reviewed: MessageOperation = {
    state: 'CONFLICT',
    issue: 'DRAFT_CONFLICT',
    revision: '5',
    remoteVersion: 'first',
  };
  const [operation, setOperation] = createSignal(reviewed);
  const resolve = vi.fn(async () => {});
  render(() => <MessageOperationRecovery source={{ operation, resolve }} />);
  await fireEvent.click(
    screen.getByRole('button', { name: 'Keep Macro version' })
  );
  setOperation({ ...reviewed, revision: '6', remoteVersion: 'second' });
  await fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(resolve).toHaveBeenCalledExactlyOnceWith(
    reviewed,
    'keep_local',
    false
  );
});

it('can recheck without ever invoking resend', async () => {
  const operation: MessageOperation = {
    state: 'UNCERTAIN',
    issue: 'SEND_UNKNOWN',
    revision: '8',
  };
  const resolve = vi.fn(async () => {});
  render(() => (
    <MessageOperationRecovery
      source={{ operation: () => operation, resolve }}
    />
  ));
  await fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
  expect(resolve).toHaveBeenCalledExactlyOnceWith(operation, 'recheck', false);
});

it('identifies the refused recipient from the authorized message without transporting its address', () => {
  const operation: MessageOperation = {
    state: 'FAILED',
    revision: '7',
    issue: 'SEND_REJECTED',
    sendRejectionReason: 'PROVIDER_REJECTED',
    sendRefusal: {
      phase: 'recipient',
      recipient_index: 1,
      reply_class: 'permanent',
    },
  };
  render(() => (
    <MessageOperationRecovery
      source={{ operation: () => operation, resolve: vi.fn() }}
      recipientEmails={['accepted@example.com', 'refused@example.com']}
    />
  ));
  expect(
    screen.getByText(/The server refused mail for refused@example.com/)
  ).toBeTruthy();
});
