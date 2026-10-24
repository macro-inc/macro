import type { ChannelInputProps } from '@channel/Input/ChannelInput';
import type { InputHandle, InputSnapshot } from '@channel/Input/types';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WhatsAppGroupProvider } from '../context/whatsapp-group-context';
import { createFakeGroup, group } from '../tests/fake-capabilities';
import { WhatsAppGroupView } from './whatsapp-group-view';

const mocks = vi.hoisted(() => ({
  composer: undefined as ChannelInputProps | undefined,
  restore: vi.fn(),
  focus: vi.fn(),
  failure: vi.fn(),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|me@example.test',
}));
vi.mock('@core/component/UserIcon', () => ({
  UserIcon: () => <span data-testid="macro-avatar" />,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure, alert: vi.fn() },
}));
vi.mock('@channel/Input/ChannelInput', () => ({
  ChannelInput: (props: ChannelInputProps) => {
    mocks.composer = props;
    const handle: InputHandle = {
      snapshot: vi.fn(),
      clear: vi.fn(),
      focus: mocks.focus,
      send: vi.fn(),
      attachFiles: vi.fn(),
      restoreSnapshot: mocks.restore,
    };
    props.onReady?.(handle);
    return <div data-testid="whatsapp-composer" />;
  },
}));

beforeEach(() => {
  mocks.composer = undefined;
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
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
function mount(fake: ReturnType<typeof createFakeGroup>) {
  const share = vi.fn();
  const connect = vi.fn();
  render(() => (
    <QueryClientProvider client={new QueryClient()}>
      <WhatsAppGroupProvider value={fake.capabilities}>
        <WhatsAppGroupView
          userId={group.ownerId}
          onShare={share}
          onConnect={connect}
        />
      </WhatsAppGroupProvider>
    </QueryClientProvider>
  ));
  return { share, connect };
}
function snapshot(value: string): InputSnapshot {
  return { value, mentions: [], attachments: [] };
}

it('renders WhatsApp messages as channel rows with quotes and reactions', () => {
  const fake = createFakeGroup();
  const { share } = mount(fake);
  expect(screen.getByText('Ana Ruiz')).toBeTruthy();
  expect(screen.getByText('Sending as +14155550142')).toBeTruthy();
  // WhatsApp's `*updated*` renders bold.
  expect(screen.getByText('updated').className).toContain('font-bold');
  expect(
    screen.getByRole('button', { name: /Ana Ruiz: The \*updated\* designs/ })
  ).toBeTruthy();
  const reaction = screen.getByRole('button', { name: /👍/ });
  expect(reaction.getAttribute('aria-pressed')).toBe('true');
  expect(reaction.textContent).toContain('2');
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  expect(share).toHaveBeenCalledOnce();
});

it('replies through the shared composer and sends WhatsApp formatting', async () => {
  const fake = createFakeGroup();
  mount(fake);
  const row = document.querySelector('[data-message-id="message-1"]');
  if (!row) throw new Error('message row missing');
  fireEvent.pointerEnter(row);
  fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
  expect(screen.getByText('Replying to Ana Ruiz')).toBeTruthy();
  expect(mocks.focus).toHaveBeenCalled();
  expect(mocks.composer?.features).toEqual({
    mentions: false,
    createItems: false,
    gifs: false,
    richBlocks: false,
  });
  await mocks.composer?.onSend?.(snapshot('Looks **great**'));
  await waitFor(() =>
    expect(fake.capabilities.send).toHaveBeenCalledWith(
      { kind: 'text', text: 'Looks *great*', replyTo: 'message-1' },
      expect.any(String)
    )
  );
  expect(screen.queryByText('Replying to Ana Ruiz')).toBeNull();
  expect(screen.getByText('Looks')).toBeTruthy();
});

it('removes a refused send, toasts the reason and restores the draft', async () => {
  const fake = createFakeGroup();
  fake.capabilities.send.mockResolvedValueOnce(
    err({ kind: 'refused', reason: "Your WhatsApp can't send to this group." })
  );
  mount(fake);
  const draft = snapshot('Hello there');
  await mocks.composer?.onSend?.(draft);
  await waitFor(() =>
    expect(mocks.failure).toHaveBeenCalledWith(
      "Your WhatsApp can't send to this group."
    )
  );
  expect(mocks.restore).toHaveBeenCalledWith(draft);
  expect(screen.queryByText('Hello there')).toBeNull();
});

it('keeps a draft WhatsApp would refuse in the composer', () => {
  const fake = createFakeGroup({
    group: { ...group, limits: { ...group.limits, textBytes: 3 } },
  });
  mount(fake);
  expect(() => mocks.composer?.onSend?.(snapshot('Too long'))).toThrow(
    'This message is too long for WhatsApp.'
  );
  expect(fake.capabilities.send).not.toHaveBeenCalled();
});

it('lets a viewer without WhatsApp read and offers to connect', () => {
  const fake = createFakeGroup({
    group: {
      ...group,
      accessLevel: 'view',
      canSend: false,
      sendReason: 'no_account',
    },
  });
  const { connect } = mount(fake);
  expect(screen.getByText('Connect your WhatsApp to reply')).toBeTruthy();
  expect(screen.queryByTestId('whatsapp-composer')).toBeNull();
  const row = document.querySelector('[data-message-id="message-1"]');
  if (!row) throw new Error('message row missing');
  fireEvent.pointerEnter(row);
  expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Connect WhatsApp' }));
  expect(connect).toHaveBeenCalledOnce();
});

it('offers actions on rows that rendered before the viewer could send', () => {
  const fake = createFakeGroup({
    group: { ...group, canSend: false, sendReason: 'disconnected' },
  });
  mount(fake);
  fake.setGroup(group);
  const row = document.querySelector('[data-message-id="message-1"]');
  if (!row) throw new Error('message row missing');
  fireEvent.pointerEnter(row);
  expect(screen.getByRole('button', { name: 'Reply' })).toBeTruthy();
});
