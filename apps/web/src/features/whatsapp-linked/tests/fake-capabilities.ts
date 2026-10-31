import { okAsync, type ResultAsync } from 'neverthrow';
import { type Accessor, createSignal, type Setter } from 'solid-js';
import { vi } from 'vitest';
import type {
  PairingRead,
  PasskeyCapability,
  RequestFailure,
  SourceRead,
  WhatsAppLinkedCapabilities,
} from '../context/whatsapp-linked-context';
import type { WhatsAppAccount } from '../core/account';
import type { AddFailure } from '../core/add';
import type { WhatsAppChat } from '../core/chat';
import type { NewChatFailure } from '../core/new-chat';
import type { PairingStep } from '../core/pairing';
import { createOpenSections } from '../primitives/open-sections';

function signalRead<Value>(
  initial: Value | undefined
): [SourceRead<Value>, Setter<Value | undefined>] {
  const [data, setData] = createSignal<Value | undefined>(initial);
  return [
    {
      get isPending() {
        return data() === undefined;
      },
      isError: false,
      get data() {
        return data();
      },
      refetch: vi.fn(),
    },
    setData,
  ];
}

/** Server state a test drives by setting signals; actions are spies. */
export function createFakeWhatsApp(initial: {
  account: WhatsAppAccount | null;
  chats?: WhatsAppChat[];
  passkey?: PasskeyCapability;
}) {
  const [account, setAccount] = signalRead<WhatsAppAccount | null>(
    initial.account
  );
  const [chats, setChats] = signalRead<WhatsAppChat[]>(initial.chats);
  // Pairings are numbered as `connect` starts them; reads are per pairing.
  let started = 0;
  const [pairings, setPairings] = createSignal<
    Record<string, PairingRead | 'error'>
  >({});
  /** The server can't read a pairing (gone, or not the caller's). */
  const failPairingRead = (pairingId: string) =>
    setPairings((current) => ({ ...current, [pairingId]: 'error' }));
  /** Report `step` for a pairing, the latest started one by default. */
  const setPairing = (
    step: PairingStep,
    options: { pairingId?: string; expiresAt?: string } = {}
  ) =>
    setPairings((current) => ({
      ...current,
      [options.pairingId ?? `pairing-${started}`]: {
        step,
        expiresAt:
          options.expiresAt ?? new Date(Date.now() + 52_000).toISOString(),
      },
    }));
  const pairingRead = (
    pairingId: Accessor<string>
  ): SourceRead<PairingRead> => ({
    get isPending() {
      return pairings()[pairingId()] === undefined;
    },
    get isError() {
      return pairings()[pairingId()] === 'error';
    },
    get data() {
      const read = pairings()[pairingId()];
      return read === 'error' ? undefined : read;
    },
    refetch: vi.fn(),
  });
  const chatsEnabled: Accessor<boolean>[] = [];
  const capabilities = {
    account,
    chats: vi.fn((enabled: Accessor<boolean>) => {
      chatsEnabled.push(enabled);
      return chats;
    }),
    passkey: initial.passkey ?? {
      kind: 'handoff',
      desktopUrl: (pairingId: string) =>
        `macro:///external?whatsappPairing=${pairingId}`,
    },
    pairing: vi.fn(pairingRead),
    connect: vi.fn(
      (): ResultAsync<
        { pairingId: string; expiresAt: string },
        RequestFailure
      > =>
        okAsync({
          pairingId: `pairing-${++started}`,
          expiresAt: new Date(Date.now() + 52_000).toISOString(),
        })
    ),
    cancelPairing: vi.fn(
      (_pairingId: string): ResultAsync<void, RequestFailure> =>
        okAsync(undefined)
    ),
    pairingFinished: vi.fn(async () => undefined),
    disconnect: vi.fn(
      (
        _generation: number
      ): ResultAsync<{ remoteUnlinkRequested: boolean }, RequestFailure> =>
        okAsync({ remoteUnlinkRequested: false })
    ),
    add: vi.fn(
      (
        _chat: Pick<WhatsAppChat, 'jid' | 'kind'>
      ): ResultAsync<{ chatId: string }, AddFailure> =>
        okAsync({ chatId: 'chat-new' })
    ),
    startChat: vi.fn(
      (_phoneNumber: string): ResultAsync<{ chatId: string }, NewChatFailure> =>
        okAsync({ chatId: 'chat-started' })
    ),
    isConnecting: () => false,
    isDisconnecting: () => false,
    openChat: vi.fn(),
    sections: createOpenSections('test:whatsapp-sections', () => undefined),
  } satisfies WhatsAppLinkedCapabilities;
  return {
    capabilities,
    setAccount,
    setChats,
    setPairing,
    failPairingRead,
    chatsEnabled,
  };
}
