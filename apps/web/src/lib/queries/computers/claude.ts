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
  | 'team_agent_row'
  /** A team agent's ready notification. */
  | 'notification';

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
    }) =>
      Telemetry.span('computer.claude.complete', async (span) => {
        span.setAttr('harness.id', vars.harnessId);
        span.setAttr('claude.sign_in.entry', vars.entry);
        // Never aborted: a code being checked finishes even if its dialog
        // closes, because the computer may still sign in.
        const answer = await computerClaudeClient.completeSignIn(
          vars.harnessId,
          vars.code.trim()
        );
        if (answer.isErr())
          span.setAttr(
            'claude.sign_in.error_code',
            answer.error[0]?.code ?? 'unknown'
          );
        const result = await throwOnErr(() => Promise.resolve(answer));
        if (!result.signedIn)
          throw new Error('Claude sign-in was not completed.');
        return result;
      }),
    onSuccess: (_result, vars) => {
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
