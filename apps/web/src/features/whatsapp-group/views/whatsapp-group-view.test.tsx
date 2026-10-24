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
import { createFakeGroup, group, messages } from '../tests/fake-capabilities';
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
          share={
            <button type="button" onClick={share}>
              Share
            </button>
          }
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
  // The composer says who is sending.
  expect(mocks.composer?.input.placeholder).toBe(
    'Message Design Crit as +14155550142'
  );
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

it('says while history imports and shows older messages as they land', () => {
  const fake = createFakeGroup({
    group: { ...group, backfill: { state: 'running', imported: 0 } },
    messages: [messages[1]],
  });
  mount(fake);
  expect(screen.getByText('WhatsApp · Importing history…')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('Importing history…');

  fake.setGroup({
    ...group,
    backfill: { state: 'waiting_for_phone', imported: 1 },
  });
  fake.setMessages(messages);
  expect(screen.getByRole('status').textContent).toBe(
    'Waiting for your phone to import history'
  );
  const ids = [...document.querySelectorAll('[data-message-id]')].map((row) =>
    row.getAttribute('data-message-id')
  );
  expect(ids).toEqual(['message-1', 'message-2']);

  fake.setGroup({ ...group, backfill: { state: 'done', imported: 1 } });
  expect(screen.queryByText(/Importing history|Waiting for/)).toBeNull();
  expect(screen.getByText('WhatsApp').textContent).toBe('WhatsApp');

  fake.setGroup({ ...group, backfill: { state: 'partial', imported: 500 } });
  expect(screen.getByText('Earlier messages stay in WhatsApp')).toBeTruthy();
});

it('tells a shared viewer whose phone the import waits for', () => {
  const fake = createFakeGroup({
    group: {
      ...group,
      accessLevel: 'view',
      canSend: false,
      sendReason: 'no_account',
      backfill: { state: 'waiting_for_phone', imported: 0 },
    },
    messages: [],
  });
  mount(fake);
  expect(
    screen.getAllByText(/Waiting for the owner's phone to import history/)
  ).toHaveLength(2);
  // Not "No messages yet" while history is still coming.
  expect(screen.queryByText(/No messages yet/)).toBeNull();
});

it('plays imported images and voice notes inline, like Chat', () => {
  const fake = createFakeGroup({
    messages: [
      {
        ...messages[0],
        body: '',
        attachments: [
          {
            ordinal: 0,
            state: 'ready',
            fileName: 'photo.jpeg',
            mime: 'image/jpeg',
            documentId: 'document-photo',
          },
          {
            ordinal: 1,
            state: 'ready',
            fileName: 'voice.ogg',
            mime: 'audio/ogg',
            documentId: 'document-voice',
          },
        ],
      },
    ],
  });
  mount(fake);
  expect(
    screen.getByRole('button', { name: 'Open image viewer' })
  ).toBeTruthy();
  const voice = screen.getByLabelText('voice.ogg');
  expect(voice.getAttribute('src')).toBe(
    'https://files.example.test/document-voice'
  );
  // Not as document chips.
  expect(screen.queryByText('photo.jpeg')).toBeNull();
});
