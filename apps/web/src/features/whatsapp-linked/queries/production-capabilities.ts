import { useUserId } from '@core/context/user';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { getDisplayName } from '@core/user/displayName';
import { isMacroId } from '@core/user/macroId';
import { fireAndForget } from '@core/util/fireAndForget';
import { queryReadyGate } from '@queries/gate';
import {
  refreshWhatsappLinkedAccount,
  useAdoptWhatsappGroupMutation,
  useCancelWhatsappPairingMutation,
  useConnectWhatsappMutation,
  useDisconnectWhatsappMutation,
  useSubmitWhatsappPasskeyMutation,
  useWhatsappLinkedAccountQuery,
  useWhatsappLinkedChatsQuery,
  useWhatsappLinkedConfigurationQuery,
  useWhatsappLinkedPairingQuery,
} from '@queries/whatsapp-linked';
import {
  traceWhatsappLoad,
  type WhatsappLoadResult,
} from '@queries/whatsapp-linked/operation';
import type { UseQueryResult } from '@tanstack/solid-query';
import { ResultAsync } from 'neverthrow';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import type {
  PasskeyCapability,
  RequestFailure,
  SourceRead,
  WhatsAppLinkedCapabilities,
} from '../context/whatsapp-linked-context';
import { accountStatus, type WhatsAppAccount } from '../core/account';
import type { AdoptFailure } from '../core/adopt';
import type { WhatsAppChat } from '../core/chat';
import {
  authenticateWhatsAppPasskey,
  canAuthenticatePasskey,
  desktopPairingUrl,
} from './authenticator';
import {
  decodeAccount,
  decodeAdoptRefusal,
  decodeChats,
  decodePairing,
} from './decode';

const failure = (): RequestFailure => ({ kind: 'request-failed' });

function sourceRead<Wire, Value>(
  query: UseQueryResult<Wire>,
  decode: (wire: Wire) => Value
): SourceRead<Value> {
  const data = createMemo(() =>
    queryReadyGate(query) ? decode(query.data) : undefined
  );
  return {
    get isPending() {
      return query.isPending;
    },
    get isError() {
      return query.isError;
    },
    get data() {
      return data();
    },
    refetch: () => fireAndForget(query.refetch(), 'whatsapp-linked'),
  };
}

/** The page has loaded once the account, and a connected account's chats, have. */
function pageLoad(
  account: SourceRead<WhatsAppAccount | null>,
  chats: SourceRead<WhatsAppChat[]> | undefined
): WhatsappLoadResult | undefined {
  if (account.isError) return { outcome: 'error' };
  if (account.data === undefined) return;
  if (accountStatus(account.data).kind !== 'connected')
    return { outcome: 'success', attrs: { 'whatsapp.connected': false } };
  if (chats?.isError) return { outcome: 'error' };
  const list = chats?.data;
  if (!list) return;
  return {
    outcome: 'success',
    attrs: {
      'whatsapp.connected': true,
      'whatsapp.chats.count': list.length,
      'whatsapp.chats.direct': list.filter((chat) => chat.kind === 'direct')
        .length,
      'whatsapp.chats.in_macro': list.filter((chat) => chat.inMacro).length,
    },
  };
}

/** The WhatsApp page's capabilities, from the shared linked-device queries. */
export function createWhatsAppLinkedCapabilities(host: {
  openGroup: (groupId: string) => void;
}): WhatsAppLinkedCapabilities {
  const user = useUserId();
  const currentUser = () => user() ?? '';
  const connect = useConnectWhatsappMutation();
  const disconnect = useDisconnectWhatsappMutation();
  const cancel = useCancelWhatsappPairingMutation();
  const adopt = useAdoptWhatsappGroupMutation();
  const submitPasskey = useSubmitWhatsappPasskeyMutation();
  const passkey: PasskeyCapability = canAuthenticatePasskey()
    ? {
        kind: 'native',
        authenticate: (pairingId, challenge, onEvent) =>
          authenticateWhatsAppPasskey(pairingId, challenge, onEvent).andThen(
            (response) =>
              ResultAsync.fromPromise(
                submitPasskey.mutateAsync({ pairingId, response }),
                () => ({
                  kind: 'passkey-failed' as const,
                  message:
                    "Your phone confirmed, but Macro couldn't pass it on to WhatsApp. Try again.",
                })
              ).map(() => undefined)
          ),
      }
    : isNativeMobilePlatform()
      ? { kind: 'unsupported' }
      : { kind: 'handoff', desktopUrl: desktopPairingUrl };
  const account = sourceRead(
    useWhatsappLinkedAccountQuery(currentUser),
    (view) => decodeAccount(view.account)
  );
  const [chatsRead, setChatsRead] = createSignal<SourceRead<WhatsAppChat[]>>();
  traceWhatsappLoad('page.load', () => pageLoad(account, chatsRead()));
  return {
    features: sourceRead(useWhatsappLinkedConfigurationQuery(), (features) => ({
      pairing: features.pairing,
      adoption: features.adoption,
    })),
    account,
    chats: (enabled: Accessor<boolean>) => {
      const read = sourceRead(
        useWhatsappLinkedChatsQuery(currentUser, enabled),
        (chats) =>
          decodeChats(chats, (ownerId) =>
            isMacroId(ownerId)
              ? getDisplayName(ownerId) || 'a teammate'
              : 'a teammate'
          )
      );
      setChatsRead(() => read);
      return read;
    },
    passkey,
    pairing: (pairingId: Accessor<string>) =>
      sourceRead(
        useWhatsappLinkedPairingQuery(currentUser, pairingId),
        decodePairing
      ),
    connect: () =>
      ResultAsync.fromPromise(connect.mutateAsync(), failure).map(
        (pairing) => ({ pairingId: pairing.id, expiresAt: pairing.expires_at })
      ),
    cancelPairing: (pairingId) =>
      ResultAsync.fromPromise(cancel.mutateAsync(pairingId), failure).map(
        () => undefined
      ),
    pairingFinished: refreshWhatsappLinkedAccount,
    disconnect: (generation) =>
      ResultAsync.fromPromise(disconnect.mutateAsync(generation), failure).map(
        (result) => ({
          remoteUnlinkRequested: result.remote_unlink_requested,
        })
      ),
    adopt: (groupJid) =>
      ResultAsync.fromPromise(
        adopt.mutateAsync({ group_jid: groupJid }),
        (error): AdoptFailure => ({
          kind: 'adopt-failed',
          ...decodeAdoptRefusal(error),
        })
      ).map((binding) => ({ groupId: binding.group_id })),
    isConnecting: () => connect.isPending,
    isDisconnecting: () => disconnect.isPending,
    openGroup: host.openGroup,
  };
}
