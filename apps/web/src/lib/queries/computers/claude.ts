import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { throwOnErr } from '@core/util/result';
import { type ErrorResponseHandler, statusError } from '@core/util/safeFetch';
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

const claudeSignInError: ErrorResponseHandler<
  'CLAUDE_INVALID_CODE' | 'CLAUDE_SIGN_IN_EXPIRED'
> = async (response) => {
  // The pending sign-in is gone: it timed out, or another tab replaced it.
  if (response.status === 404 || response.status === 410) {
    return {
      code: 'CLAUDE_SIGN_IN_EXPIRED',
      message: 'The Claude sign-in expired',
    };
  }
  if (response.status === 422) {
    const body: unknown = await response.json();
    if (
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      body.code === 'invalid_code'
    ) {
      return {
        code: 'CLAUDE_INVALID_CODE',
        message: 'Claude rejected the sign-in code',
      };
    }
  }
  return statusError(response.status);
};

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
    mutationFn: (vars: { harnessId: string; signal: AbortSignal }) =>
      Telemetry.span('computer.claude.sign_in', async (span) => {
        const { harnessId, signal } = vars;
        span.setAttr('harness.id', harnessId);
        return await throwOnErr(() =>
          fetchWithToken<ClaudeSignInStarted>(
            harnessUrl(harnessId, 'claude-sign-in'),
            { method: 'POST', signal }
          )
        );
      }),
  }));
}

export function useClaudeCompleteMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: (vars: {
      harnessId: string;
      code: string;
      signal: AbortSignal;
    }) =>
      Telemetry.span('computer.claude.complete', async (span) => {
        span.setAttr('harness.id', vars.harnessId);
        const body: ClaudeSignInComplete = { code: vars.code.trim() };
        const result = await throwOnErr(() =>
          fetchWithToken<
            ClaudeSignedIn,
            'CLAUDE_INVALID_CODE' | 'CLAUDE_SIGN_IN_EXPIRED'
          >(harnessUrl(vars.harnessId, 'claude-sign-in/complete'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            errorResponseHandler: claudeSignInError,
            signal: vars.signal,
          })
        );
        if (!result.signedIn)
          throw new Error('Claude sign-in was not completed.');
        return result;
      }),
    onSuccess: (_result, vars) => {
      if (vars.signal.aborted) return;
      queryClient.setQueryData<ClaudeModeResponse>(modeKey(vars.harnessId), {
        mode: 'own_account',
      });
      // Read back the recorded login (email, plan, signer).
      queryClient.invalidateQueries({ queryKey: modeKey(vars.harnessId) });
      // Refresh shared harness metadata without making a successful sign-in fail.
      return invalidateHarnesses();
    },
  }));
}

export function useClaudeCancelMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: (harnessId: string) =>
      Telemetry.span('computer.claude.cancel', async (span) => {
        span.setAttr('harness.id', harnessId);
        return await throwOnErr(() =>
          fetchWithToken<Record<string, never>>(
            harnessUrl(harnessId, 'claude-sign-in/cancel'),
            { method: 'POST', keepalive: true }
          )
        );
      }),
    onSuccess: (_result, harnessId) => {
      queryClient.invalidateQueries({ queryKey: modeKey(harnessId) });
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
