import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableMacroComputers } from '@core/constant/featureFlags';
import { fireAndForget } from '@core/util/fireAndForget';
import { openExternalUrl } from '@core/util/url';
import {
  useClaudeCompleteMutation,
  useClaudeModeQuery,
  useClaudeSignInMutation,
  useClaudeSignOutMutation,
} from '@queries/computers/claude';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';

export function ComputerClaudeAccess(props: {
  harnessId: string;
  canManage: boolean;
  mode: string | undefined;
}) {
  const rollout = useFeatureFlag(enableMacroComputers);
  const mode = useClaudeModeQuery(() =>
    rollout().enabled && props.canManage ? props.harnessId : undefined
  );
  const start = useClaudeSignInMutation();
  const complete = useClaudeCompleteMutation();
  const signOut = useClaudeSignOutMutation();
  const [url, setUrl] = createSignal<string>();
  const [code, setCode] = createSignal('');
  const [error, setError] = createSignal<string>();
  const pending = () =>
    start.isPending || complete.isPending || signOut.isPending;
  const currentMode = () => (mode.isSuccess ? mode.data.mode : props.mode);

  const begin = async () => {
    setError(undefined);
    try {
      const result = await start.mutateAsync(props.harnessId);
      setUrl(result.url);
      openExternalUrl(result.url);
    } catch {
      setError('Could not start Claude sign-in. Please try again.');
    }
  };
  const submit = async () => {
    if (!code().trim() || pending()) return;
    setError(undefined);
    try {
      await complete.mutateAsync({
        harnessId: props.harnessId,
        code: code().trim(),
      });
      setCode('');
      setUrl(undefined);
    } catch {
      setError(
        'Could not complete Claude sign-in. Check the code and try again.'
      );
    }
  };
  const useCredits = async () => {
    setError(undefined);
    try {
      await signOut.mutateAsync(props.harnessId);
      setCode('');
      setUrl(undefined);
    } catch {
      setError('Could not switch to Macro credits. Please try again.');
    }
  };

  return (
    <Show when={rollout().enabled}>
      <span class="flex min-w-0 flex-col items-start gap-2">
        <span>
          Claude:{' '}
          {currentMode() === 'own_account'
            ? 'your account'
            : currentMode() === 'macro_credits'
              ? 'Macro credits'
              : 'unavailable'}
        </span>
        <Show when={props.canManage}>
          <Show
            when={currentMode() === 'own_account'}
            fallback={
              <Button
                size="sm"
                variant="ghost"
                disabled={pending()}
                onClick={() => fireAndForget(begin(), 'computer-claude')}
              >
                Sign in with Claude
              </Button>
            }
          >
            <Button
              size="sm"
              variant="ghost"
              disabled={pending()}
              onClick={() => fireAndForget(useCredits(), 'computer-claude')}
            >
              Use Macro credits
            </Button>
          </Show>
          <Show when={url()}>
            {(signInUrl) => (
              <form
                class="ph-no-capture flex flex-wrap gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  fireAndForget(submit(), 'computer-claude');
                }}
              >
                <a
                  href={signInUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-accent underline"
                >
                  Open Claude sign-in
                </a>
                <label class="flex w-full flex-col gap-1">
                  Paste the code or the URL you were sent to
                  <input
                    class="rounded border border-edge-muted bg-input p-2 text-ink"
                    value={code()}
                    onInput={(event) => setCode(event.currentTarget.value)}
                    autocomplete="off"
                    spellcheck={false}
                  />
                </label>
                <Button
                  type="submit"
                  size="sm"
                  disabled={pending() || !code().trim()}
                >
                  Complete sign-in
                </Button>
              </form>
            )}
          </Show>
          <Show when={mode.isError}>
            <span role="alert" class="text-failure">
              Could not load Claude access.
            </span>
          </Show>
          <Show when={error()}>
            {(message) => (
              <span role="alert" class="text-failure">
                {message()}
              </span>
            )}
          </Show>
        </Show>
      </span>
    </Show>
  );
}
