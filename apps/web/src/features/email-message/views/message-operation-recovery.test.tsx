import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { MessageOperation } from '../core/message-operation';
import { MessageOperationRecovery } from './message-operation-recovery';

afterEach(cleanup);

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
