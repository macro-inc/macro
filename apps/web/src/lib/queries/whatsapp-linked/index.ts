import { throwOnErr } from '@core/util/result';
import { sleep } from '@core/util/sleep';
import { externalChatsClient } from '@service-storage/external-chats';
import type { ExternalChatKind } from '@service-storage/generated/schemas/externalChatKind';
import type { WhatsappPasskeyBody } from '@service-storage/generated/schemas/whatsappPasskeyBody';
import { whatsappLinkedClient as client } from '@service-storage/whatsapp-linked';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { invalidateExternalChatList } from '../external-chats';
import { whatsappLinkedKeys } from './keys';
import { whatsappOperation } from './operation';

/** How often an open pairing dialog asks for a rotated QR or a result. */
export const PAIRING_POLL_MS = 1500;

/** How often a phone-number lookup is read until WhatsApp answers. */
export const LOOKUP_POLL_MS = 1000;

function accountOptions(userId: string) {
  return queryOptions({
    queryKey: whatsappLinkedKeys.account(userId).queryKey,
    queryFn: () => throwOnErr(client.account),
    enabled: !!userId,
    staleTime: 5_000,
  });
}

function pairingOptions(userId: string, pairingId: string) {
  return queryOptions({
    queryKey: whatsappLinkedKeys.pairing(userId, pairingId).queryKey,
    queryFn: () => throwOnErr(() => client.pairing(pairingId)),
    enabled: !!userId && !!pairingId,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    // A pairing that can't be read (gone, or someone else's) never comes back.
    refetchInterval: (query) =>
      query.state.status === 'error' ? false : PAIRING_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

function chatsOptions(userId: string, enabled: boolean) {
  return queryOptions({
    queryKey: whatsappLinkedKeys.chats(userId).queryKey,
    queryFn: () => throwOnErr(client.chats),
    enabled: !!userId && enabled,
    staleTime: 10_000,
  });
}

/** The signed-in person's own linked account, or `account: null`. */
export function useWhatsappLinkedAccountQuery(userId: Accessor<string>) {
  return useQuery(() => accountOptions(userId()));
}

/** Polls one pairing transaction while its dialog is open; never cached. */
export function useWhatsappLinkedPairingQuery(
  userId: Accessor<string>,
  pairingId: Accessor<string>
) {
  return useQuery(() => pairingOptions(userId(), pairingId()));
}

/** The connected account's chat list, newest activity first, with Macro state. */
export function useWhatsappLinkedChatsQuery(
  userId: Accessor<string>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => chatsOptions(userId(), enabled()));
}

const invalidateAccount = () =>
  queryClient.invalidateQueries({
    queryKey: whatsappLinkedKeys.account._def,
  });
const invalidateChats = () =>
  queryClient.invalidateQueries({ queryKey: whatsappLinkedKeys.chats._def });

export function useConnectWhatsappMutation() {
  return useMutation(() => ({
    mutationFn: () =>
      whatsappOperation('connect', () => throwOnErr(() => client.connect())),
    onSuccess: invalidateAccount,
  }));
}

export function useDisconnectWhatsappMutation() {
  return useMutation(() => ({
    mutationFn: (authorizationGeneration: number) =>
      whatsappOperation('disconnect', () =>
        throwOnErr(() => client.disconnect(authorizationGeneration))
      ),
    onSuccess: () => Promise.all([invalidateAccount(), invalidateChats()]),
  }));
}

export function useCancelWhatsappPairingMutation() {
  return useMutation(() => ({
    mutationFn: (pairingId: string) =>
      whatsappOperation('cancel_pairing', () =>
        throwOnErr(() => client.cancelPairing(pairingId))
      ),
    onSettled: invalidateAccount,
  }));
}

/** Pairing finished: the account and its chats changed. */
export function refreshWhatsappLinkedAccount() {
  return Promise.all([invalidateAccount(), invalidateChats()]);
}

export function useSubmitWhatsappPasskeyMutation() {
  return useMutation(() => ({
    mutationFn: (input: { pairingId: string; response: WhatsappPasskeyBody }) =>
      whatsappOperation('submit_passkey', () =>
        throwOnErr(() => client.passkey(input.pairingId, input.response))
      ),
  }));
}

/**
 * Asks WhatsApp whether a number has an account and waits for the answer
 * (DSS fails a lookup WhatsApp leaves unanswered). A found number joins the
 * chat list.
 */
export function useLookUpWhatsappNumberMutation() {
  return useMutation(() => ({
    mutationFn: (phoneNumber: string) =>
      whatsappOperation('lookup', async () => {
        let lookup = await throwOnErr(() => client.startLookup(phoneNumber));
        while (lookup.state === 'pending') {
          await sleep(LOOKUP_POLL_MS);
          const id = lookup.id;
          lookup = await throwOnErr(() => client.lookup(id));
        }
        return lookup;
      }),
    onSuccess: (lookup) =>
      lookup.state === 'found' ? invalidateChats() : undefined,
  }));
}

/** Adds one of the account's WhatsApp chats to Macro as an external chat. */
export function useAddWhatsappChatMutation() {
  return useMutation(() => ({
    mutationFn: (chat: { jid: string; kind: ExternalChatKind }) =>
      whatsappOperation('add_chat', () =>
        throwOnErr(() =>
          externalChatsClient.add({
            provider: 'whatsapp',
            remoteId: chat.jid,
            kind: chat.kind,
          })
        )
      ),
    onSuccess: () =>
      Promise.all([invalidateChats(), invalidateExternalChatList()]),
  }));
}
