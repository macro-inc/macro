import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { cognitionApiServiceClient } from '@service-cognition/client';
import type {
  AddServerRequest,
  ServerResponse,
  StartAuthRequest,
  UpdateServerRequest,
} from '@service-cognition/generated/schemas';
import { useMutation, useQuery } from '@tanstack/solid-query';

const KEYS = {
  all: ['mcpServers'] as const,
  list: ['mcpServers', 'list'] as const,
};

export function useMcpServersQuery() {
  return useQuery(() => ({
    queryKey: KEYS.list,
    queryFn: async () =>
      throwOnErr(async () => await cognitionApiServiceClient.listMcpServers()),
    refetchOnMount: 'always' as const,
    refetchOnWindowFocus: 'always' as const,
  }));
}

export function invalidateMcpServers() {
  return queryClient.invalidateQueries({ queryKey: KEYS.list });
}

function upsertServer(server: ServerResponse) {
  queryClient.setQueryData(
    KEYS.list,
    (current: ServerResponse[] | undefined) => {
      if (!current) return [server];
      const index = current.findIndex((s) => s.url === server.url);
      if (index === -1) return [...current, server];
      const next = [...current];
      next[index] = server;
      return next;
    }
  );
}

function removeServer(url: string) {
  queryClient.setQueryData(
    KEYS.list,
    (current: ServerResponse[] | undefined) =>
      current?.filter((s) => s.url !== url) ?? current
  );
}

export function useAddMcpServerMutation() {
  return useMutation(() => ({
    mutationFn: async (request: AddServerRequest) =>
      throwOnErr(
        async () => await cognitionApiServiceClient.addMcpServer(request)
      ),
    onSuccess: async (server: ServerResponse) => {
      upsertServer(server);
      await invalidateMcpServers();
    },
  }));
}

export function useUpdateMcpServerMutation() {
  return useMutation(() => ({
    mutationFn: async (request: UpdateServerRequest) =>
      throwOnErr(
        async () => await cognitionApiServiceClient.updateMcpServer(request)
      ),
    onSuccess: async (server: ServerResponse) => {
      upsertServer(server);
      await invalidateMcpServers();
    },
  }));
}

export function useDeleteMcpServerMutation() {
  return useMutation(() => ({
    mutationFn: async (args: { url: string }) =>
      throwOnErr(
        async () => await cognitionApiServiceClient.deleteMcpServer(args)
      ),
    onSuccess: async (_result: unknown, variables: { url: string }) => {
      removeServer(variables.url);
      await invalidateMcpServers();
    },
  }));
}

export function useStartMcpAuthMutation() {
  return useMutation(() => ({
    mutationFn: async (request: StartAuthRequest) =>
      throwOnErr(
        async () => await cognitionApiServiceClient.startMcpAuth(request)
      ),
  }));
}
