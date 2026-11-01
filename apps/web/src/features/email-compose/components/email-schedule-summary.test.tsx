import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { type ComponentProps, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { EmailScheduleBar } from './email-schedule-summary';

vi.mock('@ui', () => ({
  Button: (props: ComponentProps<'button'>) => <button {...props} />,
  cn: (...values: (string | undefined)[]) => values.filter(Boolean).join(' '),
}));
afterEach(cleanup);

it('explains uncertain delivery and checks status without offering restoration', async () => {
  const cancel = vi.fn(async () => true);
  const check = vi.fn(async () => {});
  render(() => (
    <EmailScheduleBar
      state={{
        type: 'scheduled',
        confirmedTime: new Date(),
        deliveryStatus: 'unconfirmed',
      }}
      operation="idle"
      onSelectTime={vi.fn()}
      onCancelSchedule={cancel}
      onCheckStatus={check}
    />
  ));
  expect(screen.getByRole('status').textContent).toContain(
    'We will not resend automatically'
  );
  expect(screen.queryByRole('button', { name: /cancel|restore/i })).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: 'Check delivery status' })
  );
  await waitFor(() => expect(check).toHaveBeenCalledOnce());
  expect(cancel).not.toHaveBeenCalled();
});

it('does not offer a status action when the host has no refresh capability', () => {
  render(() => (
    <EmailScheduleBar
      state={{
        type: 'scheduled',
        confirmedTime: new Date(),
        deliveryStatus: 'unconfirmed',
      }}
      operation="idle"
      onSelectTime={vi.fn()}
      onCancelSchedule={vi.fn()}
    />
  ));
  expect(screen.getByRole('status').textContent).toContain(
    'Delivery unconfirmed'
  );
  expect(screen.queryByRole('button')).toBeNull();
});

it('shows cancellation progress while restoring a failed scheduled draft', async () => {
  const finished = Promise.withResolvers<boolean>();
  const [operation, setOperation] = createSignal<'idle' | 'cancelling'>('idle');
  const cancel = vi.fn(async () => {
    setOperation('cancelling');
    try {
      return await finished.promise;
    } finally {
      setOperation('idle');
    }
  });
  render(() => (
    <EmailScheduleBar
      state={{
        type: 'scheduled',
        confirmedTime: new Date(),
        deliveryStatus: 'failed',
      }}
      operation={operation()}
      onSelectTime={vi.fn()}
      onCancelSchedule={cancel}
    />
  ));
  expect(screen.getByRole('status').textContent).toContain(
    'Send failed before delivery'
  );
  const restore = screen.getByRole('button', {
    name: 'Restore failed scheduled draft',
  });
  fireEvent.click(restore);
  expect(restore.textContent).toBe('Cancelling…');
  expect(restore.hasAttribute('disabled')).toBe(true);
  finished.resolve(true);
  await waitFor(() => expect(restore.hasAttribute('disabled')).toBe(false));
  expect(cancel).toHaveBeenCalledOnce();
});
