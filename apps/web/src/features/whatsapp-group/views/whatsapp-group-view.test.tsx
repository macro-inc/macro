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
import type { InboundAttachment } from '../core/attachments';
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
    mentions: 'participants',
    createItems: false,
    gifs: false,
    richBlocks: false,
  });
  await mocks.composer?.onSend?.(snapshot('Looks **great**'));
  await waitFor(() =>
    expect(fake.capabilities.send).toHaveBeenCalledWith(
      {
        kind: 'text',
        text: 'Looks *great*',
        replyTo: 'message-1',
        mentions: [],
      },
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

it('mentions group participants from the composer as WhatsApp mentions', async () => {
  const fake = createFakeGroup({
    group: {
      ...group,
      members: [
        { id: '14155550142@s.whatsapp.net', name: 'Me', admin: false },
        { id: '15550001111@s.whatsapp.net', name: 'Ana Ruiz', admin: true },
        { id: '42424242@lid', name: '+42424242', admin: false },
      ],
    },
  });
  mount(fake);
  // The group's own people, not the sender, Macro users or agents.
  expect(mocks.composer?.participants?.()).toEqual([
    {
      id: '15550001111@s.whatsapp.net',
      name: 'Ana Ruiz',
      email: '+15550001111',
    },
    { id: '42424242@lid', name: '+42424242', email: '+42424242' },
  ]);
  await mocks.composer?.onSend?.(
    snapshot(
      'Thanks <m-user-mention>{"userId":"15550001111@s.whatsapp.net","email":"+15550001111","displayName":"Ana"}</m-user-mention>!'
    )
  );
  await waitFor(() =>
    expect(fake.capabilities.send).toHaveBeenCalledWith(
      {
        kind: 'text',
        text: 'Thanks @15550001111!',
        replyTo: undefined,
        mentions: ['15550001111@s.whatsapp.net'],
      },
      expect.any(String)
    )
  );
  // The pending row names the person, as the stored one will.
  expect(screen.getByText('@Ana Ruiz')).toBeTruthy();
});

it('renders every WhatsApp message type with Chat parts and small cards', () => {
  const at = (minute: number) =>
    `2026-10-21T10:${String(minute).padStart(2, '0')}:00Z`;
  const base = { ...messages[0], body: '', reactions: [], sentAt: at(0) };
  const ready = (
    ordinal: number,
    mime: string,
    extra: Partial<InboundAttachment>
  ): InboundAttachment => ({
    ordinal,
    state: 'ready',
    fileName: `file-${ordinal}`,
    mime,
    documentId: `document-${ordinal}`,
    ...extra,
  });
  const fake = createFakeGroup({
    messages: [
      {
        ...base,
        id: 'created',
        kind: 'system',
        sentAt: at(1),
        rich: {
          type: 'system',
          action: 'participants_added',
          actor: { name: 'Ana Ruiz' },
          participants: [{ name: 'Ben' }, { name: '+1 555 0100' }],
        },
      },
      {
        ...base,
        id: 'mentions',
        sentAt: at(2),
        forwarded: true,
        body: 'Hey @15550001111 and @15550002222, see https://example.com',
        mentions: [
          { token: '15550001111', name: 'Ben', userId: 'macro|ben@x.test' },
          { token: '15550002222', name: 'Cy Ode' },
        ],
      },
      {
        ...base,
        id: 'poll',
        sentAt: at(3),
        rich: {
          type: 'poll',
          question: 'Lunch?',
          options: [
            { name: 'Tacos', votes: 2, mine: true, voters: [] },
            { name: 'Pho', votes: 1, mine: false, voters: [] },
          ],
          selectableCount: 1,
          voters: 3,
        },
      },
      {
        ...base,
        id: 'location',
        sentAt: at(4),
        rich: {
          type: 'location',
          latitude: 40.7128,
          longitude: -74.006,
          name: 'City Hall',
          live: false,
        },
      },
      {
        ...base,
        id: 'contacts',
        sentAt: at(5),
        rich: {
          type: 'contacts',
          contacts: [{ name: 'Dee', phones: ['+1 (555) 010-0200'] }],
        },
      },
      {
        ...base,
        id: 'event',
        sentAt: at(6),
        rich: {
          type: 'event',
          name: 'Launch party',
          startAt: '2026-10-24T22:00:00Z',
          location: 'Rooftop',
          canceled: false,
          joinLink: 'https://call.example.com/x',
        },
      },
      {
        ...base,
        id: 'media',
        sentAt: at(7),
        attachments: [
          ready(0, 'image/webp', {
            presentation: 'sticker',
            width: 512,
            height: 512,
          }),
          ready(1, 'video/mp4', {
            presentation: 'gif',
            width: 320,
            height: 240,
          }),
          ready(2, 'audio/ogg', {
            presentation: 'voice_note',
            durationSeconds: 42,
          }),
          ready(3, 'image/jpeg', { width: 800, height: 600 }),
        ],
      },
      {
        ...base,
        id: 'call',
        kind: 'system',
        sentAt: at(8),
        rich: {
          type: 'system',
          action: 'call',
          participants: [],
          call: { video: true, outcome: 'missed' },
        },
      },
    ],
  });
  mount(fake);
  const line = document.querySelector('[data-system-activity="created"]');
  expect(line?.textContent).toContain('Ana Ruiz added Ben and +1 555 0100');
  // System lines are not messages: no avatar row, no actions.
  expect(document.querySelector('[data-message-id="created"]')).toBeNull();
  expect(
    document.querySelector('[data-system-activity="call"]')?.textContent
  ).toContain('Missed group video call');

  expect(screen.getByText('Forwarded')).toBeTruthy();
  // A Macro user becomes Chat's mention chip; anyone else their name.
  expect(
    document.querySelector(
      '[data-user-mention][data-user-id="macro|ben@x.test"]'
    )
  ).toBeTruthy();
  expect(screen.getByText('@Cy Ode')).toBeTruthy();
  expect(screen.queryByText(/@15550002222/)).toBeNull();
  // The URL stays a link, with Chat's hover preview.
  expect(
    screen
      .getByRole('link', { name: 'https://example.com' })
      .getAttribute('href')
  ).toBe('https://example.com');

  const poll = document.querySelector('[data-whatsapp-card="poll"]');
  expect(poll?.textContent).toContain('Lunch?');
  expect(poll?.textContent).toContain('Poll · Select one');
  expect(poll?.textContent).toContain('3 votes from 3 people');
  expect(screen.getByLabelText('Your vote')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Tacos/ })).toBeNull();

  const location = document.querySelector('[data-whatsapp-card="location"]');
  expect(location?.textContent).toContain('City Hall');
  expect(location?.textContent).toContain('40.7128° N, 74.0060° W');
  expect(
    screen.getByRole('link', { name: 'Open in Maps' }).getAttribute('href')
  ).toBe('https://www.google.com/maps/search/?api=1&query=40.7128%2C-74.006');

  expect(
    screen.getByRole('link', { name: '+1 (555) 010-0200' }).getAttribute('href')
  ).toBe('tel:+15550100200');
  const event = document.querySelector('[data-whatsapp-card="event"]');
  expect(event?.textContent).toContain('Launch party');
  expect(event?.textContent).toContain('Rooftop');
  expect(screen.getByRole('link', { name: 'Join' })).toBeTruthy();

  const sticker = document.querySelector('[data-whatsapp-sticker]');
  expect(sticker?.getAttribute('width')).toBe('144');
  const gif = document.querySelector<HTMLVideoElement>('[data-whatsapp-gif]');
  expect(gif?.loop).toBe(true);
  expect(gif?.muted).toBe(true);
  expect(gif?.autoplay).toBe(true);
  expect(gif?.getAttribute('width')).toBe('320');
  expect(screen.getByLabelText('Voice note · 0:42')).toBeTruthy();
  // The photo keeps its declared shape before it loads.
  expect(
    screen.getByRole('button', { name: 'Open image viewer' }).style.width
  ).toBe('400px');
});

it('quotes stickers, voice notes and cards by what they are', () => {
  const fake = createFakeGroup({
    messages: [
      {
        ...messages[0],
        body: '',
        rich: {
          type: 'poll',
          question: 'Lunch?',
          options: [],
          selectableCount: 0,
          voters: 0,
        },
      },
      { ...messages[1], replyTo: 'message-1' },
    ],
  });
  mount(fake);
  expect(
    screen.getByRole('button', { name: 'Ana Ruiz: Poll: Lunch?' })
  ).toBeTruthy();
});
