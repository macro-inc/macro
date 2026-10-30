import { toaster } from '@kobalte/core/toast';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { toast } from './Toast';
import { ToastRegion } from './ToastRegion';

const mobile = vi.hoisted(() => ({ value: false }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => mobile.value }));
vi.mock('@core/component/UploadProgress/UploadProgressIndicator', () => ({
  UploadProgressIndicator: () => null,
}));

beforeEach(() => {
  mobile.value = false;
  vi.useFakeTimers();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  toaster.clear();
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('keeps three desktop notices and queues the next until a slot opens', () => {
  render(() => <ToastRegion />);
  const first = toast.success('First saved', { stack: true });
  toast.success('Second saved', { stack: true });
  toast.success('Third saved', { stack: true });
  toast.success('Fourth saved', { stack: true });
  expect(screen.getByText('First saved')).toBeTruthy();
  expect(screen.getByText('Third saved')).toBeTruthy();
  expect(screen.queryByText('Fourth saved')).toBeNull();
  toast.dismiss(first!);
  expect(screen.queryByText('First saved')).toBeNull();
  expect(screen.getByText('Fourth saved')).toBeTruthy();
});

it('keeps persistent prompts separate from transient notices', () => {
  render(() => <ToastRegion />);
  toast.custom(
    { title: 'Reconnect account' },
    { persistent: true, region: 'prompt-region' }
  );
  toast.success('Saved', { stack: true });
  vi.advanceTimersByTime(5000);
  expect(
    screen
      .getByText('Saved')
      .closest('[data-macro-toast]')
      ?.hasAttribute('data-closed')
  ).toBe(true);
  expect(screen.getByText('Reconnect account')).toBeTruthy();
});

it('pauses the entire list while a user is reading it', () => {
  render(() => <ToastRegion />);
  toast.success('Reading this notice', { stack: true, duration: 1000 });
  const list = screen.getByText('Reading this notice').closest('ol')!;
  vi.advanceTimersByTime(300);
  fireEvent.pointerMove(list);
  vi.advanceTimersByTime(5000);
  expect(
    screen
      .getByText('Reading this notice')
      .closest('[data-macro-toast]')
      ?.hasAttribute('data-opened')
  ).toBe(true);
  fireEvent.pointerLeave(list);
  vi.advanceTimersByTime(800);
  expect(
    screen
      .getByText('Reading this notice')
      .closest('[data-macro-toast]')
      ?.hasAttribute('data-closed')
  ).toBe(true);
});

it('keeps keyboard-focused actions alive until focus leaves the list', () => {
  render(() => <ToastRegion />);
  toast.success('Keyboard notice', {
    stack: true,
    duration: 1000,
    actions: [{ label: 'Undo', onClick: vi.fn() }],
  });
  const action = screen.getByRole('button', { name: 'Undo' });
  fireEvent.focusIn(action);
  vi.advanceTimersByTime(5000);
  expect(
    screen
      .getByText('Keyboard notice')
      .closest('[data-macro-toast]')
      ?.hasAttribute('data-opened')
  ).toBe(true);
  fireEvent.focusOut(action, { relatedTarget: document.body });
  vi.advanceTimersByTime(1100);
  expect(
    screen
      .getByText('Keyboard notice')
      .closest('[data-macro-toast]')
      ?.hasAttribute('data-closed')
  ).toBe(true);
});

it('preserves actions and only reports explicit close as a user dismissal', () => {
  render(() => <ToastRegion />);
  const action = vi.fn();
  const onUserDismiss = vi.fn();
  toast.custom(
    {
      title: 'Action required',
      content: () => 'Reconnect to continue syncing.',
      actions: [{ label: 'Reconnect', onClick: action }],
    },
    { persistent: true, onUserDismiss }
  );
  fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
  expect(action).toHaveBeenCalledOnce();
  expect(onUserDismiss).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(onUserDismiss).toHaveBeenCalledOnce();
  expect(
    screen
      .getByText('Action required')
      .closest('[data-macro-toast]')
      ?.hasAttribute('data-closed')
  ).toBe(true);
});

it('does not nest buttons inside the dismiss button', () => {
  render(() => <ToastRegion />);
  toast.success('Accessible notice', { stack: true });
  const close = screen.getByRole('button', { name: 'Close' });
  expect(close.querySelector('button')).toBeNull();
});

it('keeps only the latest transient notice on mobile', () => {
  mobile.value = true;
  render(() => <ToastRegion />);
  toast.success('Older mobile notice', { stack: true });
  toast.success('Latest mobile notice', { stack: true });
  expect(screen.queryByText('Older mobile notice')).toBeNull();
  expect(screen.getByText('Latest mobile notice')).toBeTruthy();
});

it('keeps mobile prompt descriptions and close actions accessible', () => {
  mobile.value = true;
  render(() => <ToastRegion />);
  toast.custom(
    { title: 'Mobile prompt', content: () => 'Helpful details' },
    { persistent: true }
  );
  expect(screen.getByText('Helpful details')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
});
