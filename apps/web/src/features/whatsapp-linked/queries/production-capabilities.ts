import { useUserId } from '@core/context/user';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { fireAndForget } from '@core/util/fireAndForget';
import { queryReadyGate } from '@queries/gate';
import { useWhatsappGroupsQuery } from '@queries/whatsapp-groups';
import {
  refreshWhatsappLinkedAccount,
  useAdoptWhatsappGroupMutation,
  useCancelWhatsappPairingMutation,
  useConnectWhatsappMutation,
  useDisconnectWhatsappMutation,
  useSubmitWhatsappPasskeyMutation,
  useWhatsappLinkedAccountQuery,
  useWhatsappLinkedConfigurationQuery,
  useWhatsappLinkedGroupsQuery,
  useWhatsappLinkedPairingQuery,
} from '@queries/whatsapp-linked';
import type { UseQueryResult } from '@tanstack/solid-query';
import { ResultAsync } from 'neverthrow';
import { type Accessor, createMemo } from 'solid-js';
import { whatsappGroupApi } from '../../whatsapp-group/queries/production-api';
import type {
  PasskeyCapability,
  RequestFailure,
  SourceRead,
  WhatsAppLinkedCapabilities,
} from '../context/whatsapp-linked-context';
import {
  authenticateWhatsAppPasskey,
  canAuthenticatePasskey,
  desktopPairingUrl,
} from './authenticator';
import { decodeAccount, decodeGroups, decodePairing } from './decode';

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
  const sharedGroups = sourceRead(
    useWhatsappGroupsQuery(whatsappGroupApi, currentUser),
    (groups) => groups
  );
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
  return {
    features: sourceRead(useWhatsappLinkedConfigurationQuery(), (features) => ({
      pairing: features.pairing,
      adoption: features.adoption,
    })),
    account: sourceRead(useWhatsappLinkedAccountQuery(currentUser), (view) =>
      decodeAccount(view.account)
    ),
    groups: (enabled: Accessor<boolean>) =>
      sourceRead(useWhatsappLinkedGroupsQuery(currentUser, enabled), (groups) =>
        decodeGroups(groups).map((group) => ({
          ...group,
          unreadCount: sharedGroups.data?.find(
            (shared) => shared.id === group.group?.id
          )?.unreadCount,
        }))
      ),
    sharedGroups,
    passkey,
    pairing: (pairingId: Accessor<string>) =>
      sourceRead(
        useWhatsappLinkedPairingQuery(currentUser, pairingId),
        decodePairing
      ),
    connect: (replace) =>
      ResultAsync.fromPromise(connect.mutateAsync(replace), failure).map(
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
    adopt: (request) =>
      ResultAsync.fromPromise(
        adopt.mutateAsync({
          group_jid: request.groupJid,
          name: request.name,
        }),
        failure
      ).map((binding) => ({ groupId: binding.group_id })),
    isConnecting: () => connect.isPending,
    isDisconnecting: () => disconnect.isPending,
    isAdopting: () => adopt.isPending,
    openGroup: host.openGroup,
  };
}
