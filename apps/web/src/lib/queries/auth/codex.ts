import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import {
  type CodexConfig,
  type CodexLogin,
  codexClient,
} from '@service-auth/codex';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import { authKeys } from './keys';

const invalidateConnection = async () => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: authKeys.codexStatus.queryKey }),
    queryClient.invalidateQueries({
      queryKey: authKeys.codexEnvironments.queryKey,
    }),
  ]);
};
// Cached callbacks close over plain values only; hooks resolve accessors.
function codexStatusQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: authKeys.codexStatus.queryKey,
    enabled,
    queryFn: () => throwOnErr(codexClient.status),
    placeholderData: {
      connected: false,
      email: null,
      accountId: null,
      environmentId: null,
    },
  });
}
export function useCodexStatusQuery(enabled: () => boolean = () => true) {
  return useQuery(() => codexStatusQueryOptions(enabled()));
}
function codexLoginQueryOptions(login: CodexLogin | undefined) {
  const pollIntervalMs = Math.max(1, login?.pollIntervalSeconds ?? 5) * 1000;
  return queryOptions({
    queryKey: authKeys.codexLogin(login?.attemptId ?? '').queryKey,
    enabled: !!login,
    queryFn: async () => {
      if (!login) throw new Error('No active Codex login');
      const result = await throwOnErr(() => codexClient.poll(login.attemptId));
      if (result.status === 'connected') await invalidateConnection();
      return result;
    },
    retry: false,
    refetchInterval: (query) =>
      query.state.data && query.state.data.status !== 'pending'
        ? false
        : pollIntervalMs,
    refetchIntervalInBackground: true,
  });
}
export function useCodexLoginQuery(attempt: () => CodexLogin | undefined) {
  return useQuery(() => codexLoginQueryOptions(attempt()));
}
function codexEnvironmentsQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: authKeys.codexEnvironments.queryKey,
    enabled,
    queryFn: () => throwOnErr(codexClient.environments),
  });
}
export function useCodexEnvironmentsQuery(enabled: () => boolean) {
  return useQuery(() => codexEnvironmentsQueryOptions(enabled()));
}
export function useBeginCodexLogin() {
  return useMutation(() => ({
    mutationFn: () => throwOnErr(codexClient.login),
  }));
}
export function useCancelCodexLogin() {
  return useMutation(() => ({
    mutationFn: (id: string) => throwOnErr(() => codexClient.cancel(id)),
  }));
}
export function useDisconnectCodex() {
  return useMutation(() => ({
    mutationFn: () => throwOnErr(codexClient.disconnect),
    onSuccess: invalidateConnection,
  }));
}
export function useConfigureCodex() {
  return useMutation(() => ({
    mutationFn: (config: CodexConfig) =>
      throwOnErr(() => codexClient.configure(config)),
    onSuccess: invalidateConnection,
  }));
}
