import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { AiGrantActions } from './ai-grant-actions';
import type { CapabilityStatus } from './model';

vi.mock('@ui', async (importOriginal) => {
  const { mockUiWithDropdown } = await import('./mock-dropdown');
  return mockUiWithDropdown(() => importOriginal<typeof import('@ui')>());
});

it('updates connection actions after connecting, disabling, and enabling', () => {
  const [status, setStatus] = createSignal<CapabilityStatus>('not-connected');
  render(() => (
    <AiGrantActions
      status={status()}
      onConnect={() => setStatus('connected')}
      onReconnect={() => setStatus('connected')}
      onDisable={() => setStatus('off')}
      onEnable={() => setStatus('connected')}
      onDisconnect={() => setStatus('not-connected')}
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Disable' }));
  fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
  expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull();
  expect(screen.getByRole('menuitem', { name: 'Disable' })).toBeTruthy();
});
