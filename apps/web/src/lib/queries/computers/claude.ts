import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import { invalidateHarnesses } from '@queries/harnesses/harnesses';
import type {
  ClaudeModeResponse,
  ClaudeSignedIn,
  ClaudeSignInComplete,
  ClaudeSignInStarted,
} from '@service-agent-harness/generated/schemas';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import { computerKeys } from './keys';

const modeKey = (harnessId: string) =>
  computerKeys.claudeMode(harnessId).queryKey;
const harnessUrl = (harnessId: string, path: string) =>
  `${SERVER_HOSTS['agent-harness']}/harnesses/${encodeURIComponent(harnessId)}/${path}`;

function claudeModeQueryOptions(id: string) {
  return queryOptions({
    queryKey: modeKey(id),
    enabled: !!id,
    retry: false,
    queryFn: () =>
      throwOnErr(() =>
        fetchWithToken<ClaudeModeResponse>(harnessUrl(id, 'claude-mode'))
      ),
  });
}

export function useClaudeModeQuery(harnessId: () => string | undefined) {
  return useQuery(() => claudeModeQueryOptions(harnessId() ?? ''));
}

export function useClaudeSignInMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: (harnessId: string) =>
      Telemetry.span('computer.claude.sign_in', async (span) => {
        span.setAttr('harness.id', harnessId);
        return await throwOnErr(() =>
          fetchWithToken<ClaudeSignInStarted>(
            harnessUrl(harnessId, 'claude-sign-in'),
            { method: 'POST' }
          )
        );
      }),
  }));
}

export function useClaudeCompleteMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: (vars: { harnessId: string; code: string }) =>
      Telemetry.span('computer.claude.complete', async (span) => {
        span.setAttr('harness.id', vars.harnessId);
        const body: ClaudeSignInComplete = { code: vars.code.trim() };
        const result = await throwOnErr(() =>
          fetchWithToken<ClaudeSignedIn>(
            harnessUrl(vars.harnessId, 'claude-sign-in/complete'),
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }
          )
        );
        if (!result.signedIn)
          throw new Error('Claude sign-in was not completed.');
        return result;
      }),
    onSuccess: (_result, vars) => {
      queryClient.setQueryData<ClaudeModeResponse>(modeKey(vars.harnessId), {
        mode: 'own_account',
      });
      // Refresh shared harness metadata without making a successful sign-in fail.
      return invalidateHarnesses();
    },
  }));
}

export function useClaudeSignOutMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: (harnessId: string) =>
      Telemetry.span('computer.claude.sign_out', async (span) => {
        span.setAttr('harness.id', harnessId);
        return await throwOnErr(() =>
          fetchWithToken<ClaudeModeResponse>(
            harnessUrl(harnessId, 'claude-sign-out'),
            { method: 'POST' }
          )
        );
      }),
    onSuccess: (result, harnessId) => {
      queryClient.setQueryData(modeKey(harnessId), result);
      return invalidateHarnesses();
    },
  }));
}
