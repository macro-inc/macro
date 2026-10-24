import { throwOnErr } from '@core/util/result';
import type { LinkedAdoptGroup } from '@service-storage/generated/schemas/linkedAdoptGroup';
import type { LinkedPasskeyBody } from '@service-storage/generated/schemas/linkedPasskeyBody';
import { whatsappLinkedClient as client } from '@service-storage/whatsapp-linked';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { invalidateWhatsappGroups } from '../whatsapp-groups';
import { whatsappLinkedKeys } from './keys';
import { whatsappOperation } from './operation';

/** How often an open pairing dialog asks for a rotated QR or a result. */
export const PAIRING_POLL_MS = 1500;

const configurationOptions = queryOptions({
  queryKey: whatsappLinkedKeys.configuration.queryKey,
  queryFn: () => throwOnErr(client.configuration),
  staleTime: 30_000,
});

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
    refetchInterval: PAIRING_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

function groupsOptions(userId: string, enabled: boolean) {
  return queryOptions({
    queryKey: whatsappLinkedKeys.groups(userId).queryKey,
    queryFn: () => throwOnErr(client.groups),
    enabled: !!userId && enabled,
    staleTime: 10_000,
  });
}

/** Which linked-device operations the backend currently allows. */
export function useWhatsappLinkedConfigurationQuery() {
  return useQuery(() => configurationOptions);
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

/** Groups the connected account belongs to, with their adopted channel. */
export function useWhatsappLinkedGroupsQuery(
  userId: Accessor<string>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => groupsOptions(userId(), enabled()));
}

const invalidateAccount = () =>
  queryClient.invalidateQueries({
    queryKey: whatsappLinkedKeys.account._def,
  });
const invalidateGroups = () =>
  queryClient.invalidateQueries({ queryKey: whatsappLinkedKeys.groups._def });

export function useConnectWhatsappMutation() {
  return useMutation(() => ({
    mutationFn: (replace: boolean) =>
      whatsappOperation('connect', () =>
        throwOnErr(() => client.connect(replace))
      ),
    onSuccess: invalidateAccount,
  }));
}

export function useDisconnectWhatsappMutation() {
  return useMutation(() => ({
    mutationFn: (authorizationGeneration: number) =>
      whatsappOperation('disconnect', () =>
        throwOnErr(() => client.disconnect(authorizationGeneration))
      ),
    onSuccess: () => Promise.all([invalidateAccount(), invalidateGroups()]),
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

/** Pairing finished: the account and its groups changed. */
export function refreshWhatsappLinkedAccount() {
  return Promise.all([invalidateAccount(), invalidateGroups()]);
}

export function useSubmitWhatsappPasskeyMutation() {
  return useMutation(() => ({
    mutationFn: (input: { pairingId: string; response: LinkedPasskeyBody }) =>
      whatsappOperation('submit_passkey', () =>
        throwOnErr(() => client.passkey(input.pairingId, input.response))
      ),
  }));
}

export function useAdoptWhatsappGroupMutation() {
  return useMutation(() => ({
    mutationFn: (request: LinkedAdoptGroup) =>
      whatsappOperation('adopt_group', () =>
        throwOnErr(() => client.adopt(request))
      ),
    onSuccess: () =>
      Promise.all([invalidateGroups(), invalidateWhatsappGroups()]),
  }));
}
