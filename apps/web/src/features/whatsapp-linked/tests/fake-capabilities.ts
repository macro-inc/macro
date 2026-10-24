import { okAsync, type ResultAsync } from 'neverthrow';
import { type Accessor, createSignal, type Setter } from 'solid-js';
import { vi } from 'vitest';
import type { GroupSummary } from '../../whatsapp-group/core/group';
import type {
  PairingRead,
  PasskeyCapability,
  RequestFailure,
  SourceRead,
  WhatsAppLinkedCapabilities,
} from '../context/whatsapp-linked-context';
import type { WhatsAppAccount } from '../core/account';
import type { WhatsAppGroup } from '../core/group';
import type { PairingStep } from '../core/pairing';

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
  groups?: WhatsAppGroup[];
  passkey?: PasskeyCapability;
  sharedGroups?: GroupSummary[];
}) {
  const [account, setAccount] = signalRead<WhatsAppAccount | null>(
    initial.account
  );
  const [groups, setGroups] = signalRead<WhatsAppGroup[]>(initial.groups);
  const [features] = signalRead({ pairing: true, adoption: true });
  const [pairing, setPairingRead] = signalRead<PairingRead>(undefined);
  const setPairing = (step: PairingStep, expiresAt?: string) =>
    setPairingRead({
      step,
      expiresAt: expiresAt ?? new Date(Date.now() + 52_000).toISOString(),
    });
  const groupsEnabled: Accessor<boolean>[] = [];
  const capabilities = {
    features,
    sharedGroups: signalRead(initial.sharedGroups ?? [])[0],
    account,
    groups: vi.fn((enabled: Accessor<boolean>) => {
      groupsEnabled.push(enabled);
      return groups;
    }),
    passkey: initial.passkey ?? {
      kind: 'handoff',
      desktopUrl: (pairingId: string) =>
        `macro:///external?whatsappPairing=${pairingId}`,
    },
    pairing: vi.fn((_pairingId: Accessor<string>) => pairing),
    connect: vi.fn(
      (
        _replace: boolean
      ): ResultAsync<
        { pairingId: string; expiresAt: string },
        RequestFailure
      > =>
        okAsync({
          pairingId: 'pairing-1',
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
    adopt: vi.fn(
      (_request: {
        groupJid: string;
        name: string;
      }): ResultAsync<{ groupId: string }, RequestFailure> =>
        okAsync({ groupId: 'channel-new' })
    ),
    isConnecting: () => false,
    isDisconnecting: () => false,
    isAdopting: () => false,
    openGroup: vi.fn(),
  } satisfies WhatsAppLinkedCapabilities;
  return { capabilities, setAccount, setGroups, setPairing, groupsEnabled };
}
