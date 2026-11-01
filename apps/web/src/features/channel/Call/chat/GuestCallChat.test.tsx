/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import GuestCallChat from './GuestCallChat';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  refresh: vi.fn(),
  nextId: vi.fn(),
  touch: vi.fn(),
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: mocks.touch }));
vi.mock('uuid', () => ({ v7: mocks.nextId }));
vi.mock('./queries/use-guest-call-chat', () => ({
  useGuestCallChat: () => ({
    messages: () => [
      {
        id: 'member-message',
        name: 'Member',
        guest: false,
        is_you: false,
        content: 'Welcome',
      },
    ],
    ready: () => true,
    loading: () => false,
    failed: () => false,
    denied: () => false,
    sending: () => false,
    send: mocks.send,
    refresh: mocks.refresh,
  }),
}));
vi.mock('./components/CallChatPanel', () => ({
  CallChatPanel: (props: {
    open: boolean;
    children: JSX.Element;
    composer: JSX.Element;
  }) => (
    <aside hidden={!props.open}>
      {props.children}
      {props.composer}
    </aside>
  ),
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.nextId.mockReturnValue('new-id');
  mocks.send.mockResolvedValue(undefined);
});
afterEach(cleanup);

it('reads member messages, keeps drafts on close, and retries the same submission id', async () => {
  const [open, setOpen] = createSignal(true);
  render(() => (
    <GuestCallChat
      callId="call"
      session={{ token: 'token', participantId: 'guest' }}
      id="chat"
      open={open()}
      onClose={() => setOpen(false)}
    />
  ));
  expect(screen.getByText('Welcome')).toBeTruthy();
  const input = screen.getByRole('textbox') as HTMLTextAreaElement;
  fireEvent.input(input, { target: { value: 'Hello from guest' } });
  setOpen(false);
  setOpen(true);
  expect(input.value).toBe('Hello from guest');
  mocks.send.mockRejectedValueOnce(new Error('network'));
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(input.value).toBe('Hello from guest');
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(input.value).toBe(''));
  expect(mocks.nextId).toHaveBeenCalledOnce();
  expect(mocks.send.mock.calls).toEqual([
    [{ id: 'new-id', content: 'Hello from guest' }],
    [{ id: 'new-id', content: 'Hello from guest' }],
  ]);
  expect(mocks.refresh).toHaveBeenCalledOnce();
});

it('does not submit Shift+Enter or composition Enter', () => {
  render(() => (
    <GuestCallChat
      callId="call"
      session={{ token: 'token', participantId: 'guest' }}
      id="chat"
      open
      onClose={() => {}}
    />
  ));
  const input = screen.getByRole('textbox');
  fireEvent.input(input, { target: { value: 'Hello' } });
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(mocks.send).not.toHaveBeenCalled();
});

it('keeps Enter for newlines on touch and sends with the button', async () => {
  mocks.touch.mockReturnValue(true);
  render(() => (
    <GuestCallChat
      callId="call"
      session={{ token: 'token', participantId: 'guest' }}
      id="chat"
      open
      onClose={() => {}}
    />
  ));
  const input = screen.getByRole('textbox');
  expect(document.activeElement).not.toBe(input);
  fireEvent.input(input, { target: { value: 'Hello' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(mocks.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
});
