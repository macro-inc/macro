import { ThrownResultError } from '@core/util/result';
import { claudeAnswers } from './fixture-state';

// Everything else the app imports from it is the real module's.
export * from '../../../../../lib/queries/computers/claude';
export function useClaudeModeQuery() {
  return { isSuccess: false, data: undefined };
}

export function useClaudeSignOutMutation() {
  return {
    isPending: false,
    mutateAsync: async () => {
      claudeAnswers.signOutCalls += 1;
      // Long enough for a test to see the attempt on screen.
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (claudeAnswers.signOut === 'rollout_disabled')
        throw new ThrownResultError([
          { code: 'ROLLOUT_DISABLED', message: 'Not enabled' },
        ]);
      if (claudeAnswers.signOut === 'forbidden')
        throw new ThrownResultError([
          { code: 'FORBIDDEN', message: 'Forbidden' },
        ]);
      return {};
    },
  };
}

export function useClaudeSignInMutation() {
  return {
    isPending: false,
    mutateAsync: async () => ({ url: 'https://claude.ai/oauth/authorize' }),
  };
}

export function useClaudeCompleteMutation() {
  return { isPending: false, mutateAsync: async () => ({ signedIn: true }) };
}
