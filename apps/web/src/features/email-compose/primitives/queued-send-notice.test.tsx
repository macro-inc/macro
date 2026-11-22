import { toast } from '@core/component/Toast/Toast';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { toaster } from '@kobalte/core/toast';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EmailSendProgress } from '../context/compose-capabilities';
import { createComposeContext } from '../tests/capabilities';
import { announceQueuedSend } from './queued-send-notice';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/component/UploadProgress/UploadProgressIndicator', () => ({
  UploadProgressIndicator: () => null,
}));

beforeEach(() => {
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

it('does not leave a failed-send toast waiting when its page returns after another conversation', async () => {
  render(() => <ToastRegion />);
  const context = createComposeContext();
  let report: ((progress: EmailSendProgress) => void) | undefined;
  announceQueuedSend({
    notices: {
      ...context.notices,
      feedback: {
        success: toast.success,
        failure: toast.failure,
        alert: toast.alert,
        dismiss: toast.dismiss,
      },
    },
    delivery: {
      watchSend: (_id, changed) => {
        report = changed;
        return () => {};
      },
    },
    sendAttemptId: 'attempt',
    queuedOffline: false,
    undo: undefined,
  });
  if (!report) throw new Error('Expected the queued send watcher');
  report({ state: 'failed' });
  const notice = screen
    .getByText('Email failed to send')
    .closest('[data-macro-toast]');
  expect(notice?.hasAttribute('data-opened')).toBe(true);
  // The reader remains visible during the next send, then returns after the
  // recipient's conversation. The old failure must have expired meanwhile.
  await vi.advanceTimersByTimeAsync(10_000);
  window.dispatchEvent(new Event('blur'));
  await vi.advanceTimersByTimeAsync(100_000);
  window.dispatchEvent(new Event('focus'));
  document.dispatchEvent(new Event('visibilitychange'));
  report({ state: 'failed' });
  expect(notice?.hasAttribute('data-closed')).toBe(true);
  expect(
    screen
      .queryAllByText('Email failed to send')
      .filter((node) => node.closest('[data-opened]'))
  ).toHaveLength(0);
});
