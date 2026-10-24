import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DeliveryStatus } from './delivery-status';
import { InboundAttachmentPlaceholder } from './inbound-attachment';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
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

it('keeps quiet delivery states to one line and explains failures', () => {
  render(() => <DeliveryStatus state="delivered" />);
  expect(screen.getByText('Delivered')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
  cleanup();

  const onRecover = vi.fn();
  render(() => (
    <DeliveryStatus
      state="failed"
      errorCode="send_expired"
      onRecover={onRecover}
    />
  ));
  expect(screen.getByText(/waited 10 minutes and was not sent/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Edit and retry' }));
  expect(onRecover).toHaveBeenCalledOnce();
});

it('shows an imported WhatsApp file while it loads, fails, or is unsupported', () => {
  const file = { ordinal: 0, fileName: 'receipt.jpg', documentId: undefined };
  render(() => (
    <InboundAttachmentPlaceholder attachment={{ ...file, state: 'loading' }} />
  ));
  expect(screen.getByRole('status').textContent).toBe('Loading receipt.jpg…');
  cleanup();
  render(() => (
    <InboundAttachmentPlaceholder
      attachment={{ ...file, state: 'unavailable' }}
    />
  ));
  expect(screen.getByText('Attachment unavailable: receipt.jpg')).toBeTruthy();
  cleanup();
  render(() => (
    <InboundAttachmentPlaceholder
      attachment={{ ...file, state: 'unsupported' }}
    />
  ));
  expect(screen.getByText("receipt.jpg can't be shown in Macro")).toBeTruthy();
});
