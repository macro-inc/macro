import type { EmailFollowup } from '@service-storage/generated/schemas/emailFollowup';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createStore } from 'solid-js/store';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EmailReminderComposer } from './email-reminder-composer';

const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn() }));
vi.mock('@queries/reminders/email-followup', () => ({
  useEmailFollowupQuery: mocks.query,
  executeEmailFollowup: mocks.execute,
}));
vi.mock('@queries/undo', () => ({
  useMutationUndoContext: () => ({ pushUndo: vi.fn() }),
}));

const reminder: EmailFollowup = {
  threadId: 'thread',
  linkId: 'inbox',
  reminderId: 'reminder',
  revision: 'original',
  remindAt: '2027-12-01T12:00:00Z',
  condition: 'regardless',
  state: 'pending',
};

beforeEach(() => {
  vi.resetAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn();
});
afterEach(cleanup);

function setup() {
  const [query, setQuery] = createStore({
    isSuccess: false,
    isError: false,
    data: undefined as EmailFollowup | null | undefined,
    refetch: vi.fn(),
  });
  mocks.query.mockReturnValue(query);
  const close = vi.fn();
  render(() => (
    <EmailReminderComposer
      entity={{ id: 'thread', type: 'email', name: 'A conversation' }}
      open={true}
      onOpenChange={close}
    />
  ));
  return { query, setQuery, close };
}

it('opens the time picker immediately and keeps its input and focus when the lookup resolves', async () => {
  const { setQuery } = setup();
  const input = screen.getByRole('combobox', { name: 'Remind me when' });
  expect(screen.queryByText('Loading reminder…')).toBeNull();
  expect(screen.getByRole('option', { name: /In 30m/ })).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(input));
  fireEvent.input(input, { target: { value: 'in 2 hours' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(mocks.execute).not.toHaveBeenCalled();

  setQuery({ isSuccess: true, data: reminder });
  expect(screen.getByRole('combobox')).toBe(input);
  expect(document.activeElement).toBe(input);
  expect((input as HTMLInputElement).value).toBe('in 2 hours');
  expect(screen.getByText(/Scheduled for/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Remove reminder' })).toBeTruthy();
  mocks.execute.mockResolvedValue({ ...reminder, revision: 'saved' });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(mocks.execute).toHaveBeenCalledOnce());
  expect(mocks.execute).toHaveBeenCalledWith(
    'thread',
    expect.objectContaining({
      condition: 'regardless',
      expectedRevision: 'original',
    }),
    expect.any(Function)
  );
});

it('preserves a condition chosen before the existing reminder arrives', async () => {
  const { setQuery } = setup();
  fireEvent.click(screen.getByRole('radio', { name: 'Regardless' }));
  setQuery({
    isSuccess: true,
    data: { ...reminder, condition: 'if_no_reply' },
  });
  mocks.execute.mockResolvedValue(reminder);
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
  await waitFor(() => expect(mocks.execute).toHaveBeenCalledOnce());
  expect(mocks.execute.mock.calls[0][1].condition).toBe('regardless');
});

it('keeps the same picker on failure and retry, without permitting an unchecked write', async () => {
  const { query, setQuery } = setup();
  const input = screen.getByRole('combobox');
  fireEvent.input(input, { target: { value: 'in 2 hours' } });
  setQuery({ isError: true });
  expect(screen.getByRole('alert').textContent).toContain('Couldn’t load');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(mocks.execute).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(query.refetch).toHaveBeenCalledOnce();
  setQuery({ isError: false, isSuccess: true, data: null });
  expect(screen.getByRole('combobox')).toBe(input);
  expect((input as HTMLInputElement).value).toBe('in 2 hours');
  expect(screen.queryByRole('alert')).toBeNull();
  mocks.execute.mockResolvedValue(reminder);
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(mocks.execute).toHaveBeenCalledOnce());
});

it('allows cancellation while the initial lookup is pending', () => {
  const { close } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(close).toHaveBeenCalledWith(false);
  expect(mocks.execute).not.toHaveBeenCalled();
});
