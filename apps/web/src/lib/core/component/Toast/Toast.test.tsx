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
      unobserve() {}
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

it('preserves an earlier failure action when the next failure opts out of deduplication', () => {
  render(() => <ToastRegion />);
  const retryFirst = vi.fn();
  const retrySecond = vi.fn();
  toast.failure('Folder creation failed', {
    actions: [{ label: 'Retry first', onClick: retryFirst }],
  });
  toast.failure('Folder creation failed', {
    stack: true,
    actions: [{ label: 'Retry second', onClick: retrySecond }],
  });
  fireEvent.click(screen.getByRole('button', { name: 'Retry first' }));
  fireEvent.click(screen.getByRole('button', { name: 'Retry second' }));
  expect(retryFirst).toHaveBeenCalledOnce();
  expect(retrySecond).toHaveBeenCalledOnce();
});

it('still replaces stacked failure notices on mobile', () => {
  mobile.value = true;
  render(() => <ToastRegion />);
  toast.failure('Earlier failure', { stack: true });
  toast.failure('Latest failure', { stack: true });
  expect(screen.queryByText('Earlier failure')).toBeNull();
  expect(screen.getByText('Latest failure')).toBeTruthy();
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

it('preserves actions and only reports explicit dismissal as a user dismissal', () => {
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
  expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
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

it('keeps mobile prompt descriptions accessible', () => {
  mobile.value = true;
  render(() => <ToastRegion />);
  toast.custom(
    { title: 'Mobile prompt', content: () => 'Helpful details' },
    { persistent: true }
  );
  expect(screen.getByText('Helpful details')).toBeTruthy();
});

it('changes an open toast in place through each state of one process', () => {
  render(() => <ToastRegion />);
  const onDismiss = vi.fn();
  const id = toast.success('Sending…', {
    persistent: true,
    actions: [{ label: 'Undo', onClick: vi.fn() }],
    onDismiss,
  });
  vi.advanceTimersByTime(10_000);
  expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();

  expect(toast.success('Sending…', { persistent: true, replace: id })).toBe(id);
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  vi.advanceTimersByTime(10_000);
  expect(toast.success('Email sent', { replace: id })).toBe(id);
  expect(screen.queryByText('Sending…')).toBeNull();
  const sent = screen.getByText('Email sent').closest('[data-macro-toast]');
  expect(sent?.hasAttribute('data-opened')).toBe(true);
  expect(sent?.hasAttribute('data-replaced')).toBe(true);
  expect(screen.getAllByRole('status', { hidden: true }).length).toBe(1);
  expect(onDismiss).not.toHaveBeenCalled();

  // The replacement keeps its own timing.
  vi.advanceTimersByTime(4600);
  expect(sent?.hasAttribute('data-closed')).toBe(true);
});

it('opens a new toast when the one it would replace has closed', () => {
  render(() => <ToastRegion />);
  const id = toast.success('Sending…', { persistent: true });
  toast.dismiss(id!);
  const next = toast.failure('Email failed to send', { replace: id });
  expect(next).not.toBe(id);
  expect(screen.getByText('Email failed to send')).toBeTruthy();
});

it('turns a timed toast persistent in place', () => {
  render(() => <ToastRegion />);
  const id = toast.success('Email queued to send');
  vi.advanceTimersByTime(3000);
  toast.failure('Email failed to send', { persistent: true, replace: id });
  vi.advanceTimersByTime(10_000);
  expect(
    screen
      .getByText('Email failed to send')
      .closest('[data-macro-toast]')
      ?.hasAttribute('data-opened')
  ).toBe(true);
});

it('lets the next mobile notice replace a persistent notice', () => {
  mobile.value = true;
  render(() => <ToastRegion />);
  toast.success('Sending…', { persistent: true });
  toast.success('Copied', { stack: true });
  expect(screen.queryByText('Sending…')).toBeNull();
  expect(screen.getByText('Copied')).toBeTruthy();
});

it('keeps a mobile notice in the slot when it changes in place', () => {
  mobile.value = true;
  render(() => <ToastRegion />);
  const id = toast.success('Sending…', { persistent: true });
  toast.success('Email sent', { replace: id });
  expect(screen.getByText('Email sent')).toBeTruthy();
  toast.success('Later notice', { stack: true });
  expect(screen.queryByText('Email sent')).toBeNull();
  expect(screen.getByText('Later notice')).toBeTruthy();
});

it('gives a timed toast its full time again when it changes in place', () => {
  render(() => <ToastRegion />);
  const id = toast.success('Email queued to send');
  vi.advanceTimersByTime(4000);
  toast.success('Email sent', { replace: id });
  vi.advanceTimersByTime(4000);
  expect(
    screen
      .getByText('Email sent')
      .closest('[data-macro-toast]')
      ?.hasAttribute('data-opened')
  ).toBe(true);
});

it('opens a new toast in place of one the mobile slot dismissed before it showed', () => {
  mobile.value = true;
  render(() => <ToastRegion />);
  toast.custom({ title: 'Email failed to send' }, { persistent: true });
  const queued = toast.success('Sending…');
  toast.success('Copied');
  const next = toast.success('Email sent', { replace: queued });
  expect(next).not.toBe(queued);
});

it('reports closing a toast that was dismissed before it showed', () => {
  render(() => <ToastRegion />);
  toast.success('First', { stack: true });
  toast.success('Second', { stack: true });
  toast.success('Third', { stack: true });
  const onDismiss = vi.fn();
  const queued = toast.success('Queued', { stack: true, onDismiss });
  toast.dismiss(queued!);
  toast.dismiss(queued!);
  expect(onDismiss).toHaveBeenCalledOnce();
});
