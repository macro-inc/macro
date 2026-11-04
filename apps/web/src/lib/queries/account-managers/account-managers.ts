import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { storageServiceClient } from '@service-storage/client';
import type { AccountManagerDecision } from '@service-storage/generated/schemas/accountManagerDecision';
import type { AccountManagerGrant } from '@service-storage/generated/schemas/accountManagerGrant';
import type { AccountManagerRole } from '@service-storage/generated/schemas/accountManagerRole';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { accountManagerKeys } from './keys';

function storeGrant(grant: AccountManagerGrant) {
  queryClient.setQueryData(accountManagerKeys.grant(grant.id).queryKey, grant);
  return queryClient.invalidateQueries({
    queryKey: accountManagerKeys.list.queryKey,
  });
}

export function useAccountManagersQuery() {
  return useQuery(() => ({
    queryKey: accountManagerKeys.list.queryKey,
    queryFn: () => throwOnErr(() => storageServiceClient.listAccountManagers()),
  }));
}

export function useAccountManagerGrantQuery(id: Accessor<string>) {
  return useQuery(() => ({
    queryKey: accountManagerKeys.grant(id()).queryKey,
    queryFn: () =>
      throwOnErr(() =>
        storageServiceClient.getAccountManagerGrant({ id: id() })
      ),
    retry: false,
  }));
}

export function useRequestAccountManagerMutation() {
  return useMutation(() => ({
    mutationFn: (vars: {
      counterpartyId: string;
      callerRole: AccountManagerRole;
    }) => throwOnErr(() => storageServiceClient.requestAccountManager(vars)),
    onSuccess: storeGrant,
  }));
}

export function useRespondToAccountManagerRequestMutation() {
  return useMutation(() => ({
    mutationFn: (vars: { id: string; decision: AccountManagerDecision }) =>
      throwOnErr(() =>
        storageServiceClient.respondToAccountManagerRequest(vars)
      ),
    onSuccess: storeGrant,
  }));
}

export function useClaimAccountManagerTokenMutation() {
  return useMutation(() => ({
    // The result holds the secret, so the cache must not keep it.
    gcTime: 0,
    mutationFn: (vars: { id: string }) =>
      throwOnErr(() => storageServiceClient.claimAccountManagerToken(vars)),
    onSuccess: (claimed) => storeGrant(claimed.grant),
  }));
}

export function useRevokeAccountManagerGrantMutation() {
  return useMutation(() => ({
    mutationFn: (vars: { id: string }) =>
      throwOnErr(() => storageServiceClient.revokeAccountManagerGrant(vars)),
    onSuccess: storeGrant,
  }));
}
