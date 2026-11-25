import { toast } from '@core/component/Toast/Toast';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { toaster } from '@kobalte/core/toast';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
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

it('keeps one failed-send toast visible across time and focus changes', async () => {
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
  // A failure still needs the reader's attention after a focus change.
  await vi.advanceTimersByTimeAsync(10_000);
  window.dispatchEvent(new Event('blur'));
  await vi.advanceTimersByTimeAsync(100_000);
  window.dispatchEvent(new Event('focus'));
  document.dispatchEvent(new Event('visibilitychange'));
  report({ state: 'failed' });
  expect(notice?.hasAttribute('data-opened')).toBe(true);
  expect(
    screen
      .queryAllByText('Email failed to send')
      .filter((node) => node.closest('[data-opened]'))
  ).toHaveLength(1);
});

it('keeps a dismissed failure closed when returning to the page and shows a new attempt', () => {
  const [showPage, setShowPage] = createSignal(true);
  render(() => (
    <Show when={showPage()}>
      <ToastRegion />
    </Show>
  ));
  const context = createComposeContext();
  const fail = (sendAttemptId: string) => {
    announceQueuedSend({
      notices: {
        ...context.notices,
        feedback: {
          success: toast.success,
          failure: (title, options) =>
            toast.custom(
              { title, content: () => options?.subtext },
              {
                persistent: options?.persistent,
                replace: options?.replace,
                onUserDismiss: options?.onUserDismiss,
              }
            ),
          alert: toast.alert,
          dismiss: toast.dismiss,
        },
      },
      delivery: {
        watchSend: (_id, changed) => {
          changed({ state: 'failed' });
          return () => {};
        },
      },
      sendAttemptId,
      queuedOffline: false,
      undo: undefined,
    });
  };
  fail('first-attempt');
  setShowPage(false);
  setShowPage(true);
  expect(screen.getByText('Email failed to send')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  setShowPage(false);
  setShowPage(true);
  expect(screen.queryByText('Email failed to send')).toBeNull();

  fail('retry-attempt');
  expect(screen.getAllByText('Email failed to send')).toHaveLength(1);
});
