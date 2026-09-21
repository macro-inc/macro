// @vitest-environment jsdom

import type { WithCustomUserInput } from '@core/user';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { CalendarQuickCall } from './calendar-quick-call';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  invite: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('@queries/call/meetings', () => ({
  useCreateMeetingMutation: () => ({ mutateAsync: mocks.create }),
  useInviteToMeetingMutation: () => ({ mutateAsync: mocks.invite }),
}));
vi.mock('@solidjs/router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@core/signal/useCombinedRecipient', () => ({
  useCombinedRecipients: () => ({ all: () => [] }),
}));
vi.mock('@core/component/RecipientSelector', () => ({
  RecipientSelector: (props: {
    setSelectedOptions: (
      people: WithCustomUserInput<'user' | 'contact'>[]
    ) => void;
  }) => (
    <button
      onClick={() =>
        props.setSelectedOptions(
          ['first@outside.example', 'second@outside.example'].map((email) => ({
            kind: 'custom',
            id: `macro|${email}`,
            data: { id: `macro|${email}`, email, invalid: false },
          }))
        )
      }
    >
      Select guests
    </button>
  ),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('reuses a created Quick Call and sends only failed invitations on retry', async () => {
  mocks.create.mockResolvedValue({ shareToken: 'same-call' });
  mocks.invite
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(undefined);
  render(() => <CalendarQuickCall />);
  fireEvent.click(screen.getByRole('button', { name: 'Select guests' }));
  fireEvent.click(screen.getByRole('button', { name: 'Call' }));
  await vi.waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(mocks.navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Call' }));
  await vi.waitFor(() =>
    expect(mocks.navigate).toHaveBeenCalledWith('/meet/same-call?start=true')
  );
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.invite.mock.calls.map(([arg]) => arg.email)).toEqual([
    'first@outside.example',
    'second@outside.example',
    'second@outside.example',
  ]);
});
