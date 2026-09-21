import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import {
  type CodexConfig,
  type CodexLogin,
  codexClient,
} from '@service-auth/codex';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { authKeys } from './keys';

const invalidateConnection = async () => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: authKeys.codexStatus.queryKey }),
    queryClient.invalidateQueries({
      queryKey: authKeys.codexEnvironments.queryKey,
    }),
  ]);
};
export function useCodexStatusQuery(enabled: () => boolean = () => true) {
  return useQuery(() => ({
    queryKey: authKeys.codexStatus.queryKey,
    enabled: enabled(),
    queryFn: () => throwOnErr(codexClient.status),
    placeholderData: {
      connected: false,
      email: null,
      accountId: null,
      environmentId: null,
    },
  }));
}
export function useCodexLoginQuery(attempt: () => CodexLogin | undefined) {
  return useQuery(() => ({
    queryKey: authKeys.codexLogin(attempt()?.attemptId ?? '').queryKey,
    enabled: !!attempt(),
    queryFn: async () => {
      const login = attempt();
      if (!login) throw new Error('No active Codex login');
      const result = await throwOnErr(() => codexClient.poll(login.attemptId));
      if (result.status === 'connected') await invalidateConnection();
      return result;
    },
    retry: false,
    refetchInterval: (query) =>
      query.state.data && query.state.data.status !== 'pending'
        ? false
        : Math.max(1, attempt()?.pollIntervalSeconds ?? 5) * 1000,
    refetchIntervalInBackground: true,
  }));
}
export function useCodexEnvironmentsQuery(enabled: () => boolean) {
  return useQuery(() => ({
    queryKey: authKeys.codexEnvironments.queryKey,
    enabled: enabled(),
    queryFn: () => throwOnErr(codexClient.environments),
  }));
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
