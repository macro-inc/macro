import { createSignal } from 'solid-js';

const [mode, setMode] = createSignal('macro_credits');
export const useClaudeModeQuery = () => ({
  isSuccess: true,
  isError: false,
  get data() {
    return { mode: mode() };
  },
});
export const useClaudeSignInMutation = () => ({
  isPending: false,
  mutateAsync: async () => ({ url: 'https://claude.ai/oauth/authorize' }),
});
export const useClaudeCompleteMutation = () => ({
  isPending: false,
  mutateAsync: async (vars: { code: string }) => {
    document.body.dataset.submittedCode = vars.code;
    setMode('own_account');
    return { signedIn: true };
  },
});
export const useClaudeSignOutMutation = () => ({
  isPending: false,
  mutateAsync: async () => {
    setMode('macro_credits');
    return { mode: 'macro_credits' };
  },
});
