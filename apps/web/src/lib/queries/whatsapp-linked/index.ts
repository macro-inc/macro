import { throwOnErr } from '@core/util/result';
import type { LinkedAdoptGroup } from '@service-storage/generated/schemas/linkedAdoptGroup';
import type { MetaSendReply } from '@service-storage/generated/schemas/metaSendReply';
import { whatsappLinkedClient as client } from '@service-storage/whatsapp-linked';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { linkedKeys } from './keys';

export function useLinkedConfiguration() {
  return useQuery(() => ({
    queryKey: linkedKeys.configuration.queryKey,
    queryFn: () => throwOnErr(client.configuration),
    staleTime: 30000,
  }));
}
function accountOptions(user: string) {
  return {
    queryKey: linkedKeys.account(user).queryKey,
    queryFn: () => throwOnErr(client.account),
    enabled: !!user,
    staleTime: 5000,
  };
}
export function useLinkedAccount(user: Accessor<string>) {
  return useQuery(() => accountOptions(user()));
}
function pairOptions(user: string, id: string) {
  return {
    queryKey: linkedKeys.pairing(user, id).queryKey,
    queryFn: () => throwOnErr(() => client.pair(id)),
    enabled: !!user && !!id,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchInterval: 1500,
    refetchIntervalInBackground: false,
  };
}
export function useLinkedPairing(user: Accessor<string>, id: Accessor<string>) {
  return useQuery(() => pairOptions(user(), id()));
}
function groupsOptions(user: string, enabled: boolean) {
  return {
    queryKey: linkedKeys.groups(user).queryKey,
    queryFn: () => throwOnErr(client.groups),
    enabled: !!user && enabled,
    gcTime: 0,
    staleTime: 0,
  };
}
export function useLinkedGroups(
  user: Accessor<string>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => groupsOptions(user(), enabled()));
}
function channelOptions(id: string, enabled: boolean) {
  return {
    queryKey: linkedKeys.channel(id).queryKey,
    queryFn: () => throwOnErr(() => client.channel(id)),
    enabled: !!id && enabled,
    staleTime: 5000,
    refetchInterval: enabled ? 15000 : (false as const),
    refetchIntervalInBackground: false,
  };
}
export function useLinkedChannel(
  id: Accessor<string>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => channelOptions(id(), enabled()));
}
function deliveryOptions(id: string, messages: string[]) {
  return {
    queryKey: linkedKeys.delivery(id, messages).queryKey,
    queryFn: () => throwOnErr(() => client.delivery(id, messages)),
    enabled: !!id && messages.length > 0,
    staleTime: 15000,
  };
}
export function useLinkedDelivery(
  id: Accessor<string>,
  messages: Accessor<string[]>
) {
  return useQuery(() => deliveryOptions(id(), messages()));
}
const refresh = () =>
  queryClient.invalidateQueries({ queryKey: ['whatsapp-linked'] });
export function useLinkedActions() {
  return {
    connect: useMutation(() => ({
      mutationFn: (replace: boolean) =>
        throwOnErr(() => client.connect(replace)),
      onSuccess: refresh,
    })),
    disconnect: useMutation(() => ({
      mutationFn: (generation: number) =>
        throwOnErr(() => client.disconnect(generation)),
      onSuccess: refresh,
    })),
    cancel: useMutation(() => ({
      mutationFn: (id: string) => throwOnErr(() => client.cancel(id)),
      onSuccess: refresh,
    })),
    passkey: useMutation(() => ({
      mutationFn: (input: { id: string; response: unknown }) =>
        throwOnErr(() => client.passkey(input.id, input.response)),
    })),
    confirm: useMutation(() => ({
      mutationFn: (id: string) => throwOnErr(() => client.confirm(id)),
    })),
    adopt: useMutation(() => ({
      mutationFn: (request: LinkedAdoptGroup) =>
        throwOnErr(() => client.adopt(request)),
      onSuccess: refresh,
    })),
    grant: useMutation(() => ({
      mutationFn: (input: { channel: string; users: string[] }) =>
        throwOnErr(() => client.grant(input.channel, input.users)),
      onSuccess: refresh,
    })),
    transfer: useMutation(() => ({
      mutationFn: (input: { channel: string; owner: string }) =>
        throwOnErr(() => client.transfer(input.channel, input.owner)),
      onSuccess: refresh,
    })),
    detach: useMutation(() => ({
      mutationFn: (id: string) => throwOnErr(() => client.detach(id)),
      onSuccess: refresh,
    })),
  };
}
export function useLinkedReply(channel: Accessor<string>) {
  return useMutation(() => ({
    mutationFn: (request: MetaSendReply) =>
      throwOnErr(() => client.send(channel(), request)),
    onSuccess: refresh,
  }));
}
export function useLinkedUpload(channel: Accessor<string>) {
  return useMutation(() => ({
    mutationFn: (file: File) =>
      throwOnErr(() => client.upload(channel(), file)),
  }));
}
