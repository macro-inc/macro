import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProviderSwitcher } from './provider-switcher';

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('switches between enabled providers and counts the others’ unread chats', () => {
  const onSelect = vi.fn();
  render(() => (
    <ProviderSwitcher
      providers={['whatsapp', 'slack']}
      selected="whatsapp"
      unread={(provider) => (provider === 'slack' ? 3 : 0)}
      onSelect={onSelect}
    />
  ));

  const group = screen.getByRole('radiogroup', { name: 'External apps' });
  const whatsapp = screen.getByRole('radio', { name: /WhatsApp/ });
  const slack = screen.getByRole('radio', { name: /Slack/ });
  expect(group).toBeTruthy();
  expect((whatsapp as HTMLInputElement).checked).toBe(true);
  expect(group.textContent).toMatch(/Slack\s*3/);

  fireEvent.click(slack);
  expect(onSelect).toHaveBeenCalledExactlyOnceWith('slack');
});
