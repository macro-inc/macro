import { throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import { invalidateHarnesses } from '@queries/harnesses/harnesses';
import { computerClaudeClient } from '@service-agent-harness/computer-claude';
import type { ClaudeModeResponse } from '@service-agent-harness/generated/schemas';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import { computerKeys } from './keys';

const modeKey = (harnessId: string) =>
  computerKeys.claudeMode(harnessId).queryKey;

function claudeModeQueryOptions(id: string) {
  return queryOptions({
    queryKey: modeKey(id),
    enabled: !!id,
    retry: false,
    queryFn: () => throwOnErr(() => computerClaudeClient.mode(id)),
  });
}

export function useClaudeModeQuery(harnessId: () => string | undefined) {
  return useQuery(() => claudeModeQueryOptions(harnessId() ?? ''));
}

/** Where a Claude sign-in was opened, so traces can tell the flows apart. */
export type ClaudeSignInEntry =
  | 'computer_setup'
  | 'computer_row'
  | 'team_agent_invite'
  | 'team_agent_row';

export function useClaudeSignInMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: (vars: {
      harnessId: string;
      entry: ClaudeSignInEntry;
      signal: AbortSignal;
    }) =>
      Telemetry.span('computer.claude.sign_in', async (span) => {
        const { harnessId, signal } = vars;
        span.setAttr('harness.id', harnessId);
        span.setAttr('claude.sign_in.entry', vars.entry);
        return await throwOnErr(() =>
          computerClaudeClient.startSignIn(harnessId, signal)
        );
      }),
  }));
}

export function useClaudeCompleteMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: (vars: {
      harnessId: string;
      entry: ClaudeSignInEntry;
      code: string;
      signal: AbortSignal;
    }) =>
      Telemetry.span('computer.claude.complete', async (span) => {
        span.setAttr('harness.id', vars.harnessId);
        span.setAttr('claude.sign_in.entry', vars.entry);
        const result = await throwOnErr(() =>
          computerClaudeClient.completeSignIn(
            vars.harnessId,
            vars.code.trim(),
            vars.signal
          )
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
      // Read back the recorded login (signer, expiry).
      queryClient.invalidateQueries({ queryKey: modeKey(vars.harnessId) });
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
        return await throwOnErr(() => computerClaudeClient.signOut(harnessId));
      }),
    onSuccess: (result, harnessId) => {
      queryClient.setQueryData(modeKey(harnessId), result);
      return invalidateHarnesses();
    },
  }));
}
