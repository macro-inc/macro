import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { enableMacroComputers } from '@core/constant/featureFlags';
import { fireAndForget } from '@core/util/fireAndForget';
import { thrownResultErrorHasCode } from '@core/util/result';
import { openExternalUrl } from '@core/util/url';
import {
  useClaudeCancelMutation,
  useClaudeCompleteMutation,
  useClaudeModeQuery,
  useClaudeSignInMutation,
  useClaudeSignOutMutation,
} from '@queries/computers/claude';
import { Button, Input } from '@ui';
import { createSignal, onCleanup, Show } from 'solid-js';

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
  const cancel = useClaudeCancelMutation();
  let request: AbortController | undefined;
  let generation = 0;
  const [url, setUrl] = createSignal<string>();
  const [code, setCode] = createSignal('');
  const [error, setError] = createSignal<string>();
  const pending = () =>
    start.isPending ||
    complete.isPending ||
    signOut.isPending ||
    cancel.isPending;
  const currentMode = () => (mode.isSuccess ? mode.data.mode : props.mode);

  onCleanup(() => {
    generation++;
    request?.abort();
    if (url() || start.isPending || complete.isPending) {
      fireAndForget(cancel.mutateAsync(props.harnessId), 'computer-claude');
    }
  });

  const begin = async () => {
    if (pending() || url()) return;
    const current = ++generation;
    request = new AbortController();
    setError(undefined);
    try {
      const result = await start.mutateAsync({
        harnessId: props.harnessId,
        signal: request.signal,
      });
      if (current !== generation) return;
      setUrl(result.url);
      openExternalUrl(result.url);
    } catch (error) {
      if (current !== generation) return;
      setError(
        thrownResultErrorHasCode(error, 'CONFLICT')
          ? t('computers.claudeSignInConflict')
          : t('computers.claudeStartFailed')
      );
    }
  };
  const submit = async () => {
    if (!code().trim() || pending()) return;
    const current = ++generation;
    request = new AbortController();
    setError(undefined);
    try {
      await complete.mutateAsync({
        harnessId: props.harnessId,
        code: code().trim(),
        signal: request.signal,
      });
      if (current !== generation) return;
      setCode('');
      setUrl(undefined);
    } catch (error) {
      if (current !== generation) return;
      if (thrownResultErrorHasCode(error, 'CLAUDE_INVALID_CODE')) {
        setCode('');
        setUrl(undefined);
        setError(t('computers.claudeInvalidCode'));
        return;
      }
      setError(
        thrownResultErrorHasCode(error, 'CONFLICT')
          ? t('computers.claudeSignInConflict')
          : t('computers.claudeCompleteFailed')
      );
    }
  };
  const cancelSignIn = async () => {
    generation++;
    setError(undefined);
    try {
      await cancel.mutateAsync(props.harnessId);
      setCode('');
      setUrl(undefined);
    } catch {
      setError(t('computers.claudeCancelFailed'));
    }
  };
  const useCredits = async () => {
    setError(undefined);
    try {
      await signOut.mutateAsync(props.harnessId);
      setCode('');
      setUrl(undefined);
    } catch {
      setError(t('computers.claudeCreditsFailed'));
    }
  };

  return (
    <Show when={rollout().enabled}>
      <span class="flex min-w-0 flex-col items-start gap-2">
        <span>
          {currentMode() === 'own_account'
            ? t('computers.claudeOwnAccount')
            : currentMode() === 'macro_credits'
              ? t('computers.claudeCredits')
              : t('computers.claudeUnavailable')}
        </span>
        <Show when={props.canManage}>
          <Show
            when={currentMode() === 'own_account'}
            fallback={
              <Button
                size="sm"
                variant="ghost"
                disabled={pending() || !!url()}
                onClick={() => fireAndForget(begin(), 'computer-claude')}
              >
                {t('computers.claudeSignIn')}
              </Button>
            }
          >
            <Button
              size="sm"
              variant="ghost"
              disabled={pending()}
              onClick={() => fireAndForget(useCredits(), 'computer-claude')}
            >
              {t('computers.useCredits')}
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
                  {t('computers.openClaudeSignIn')}
                </a>
                <label class="flex w-full flex-col gap-1">
                  {t('computers.claudeCodeLabel')}
                  <Input
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
                  {t('computers.completeSignIn')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={cancel.isPending}
                  onClick={() =>
                    fireAndForget(cancelSignIn(), 'computer-claude')
                  }
                >
                  {t('common.cancel')}
                </Button>
              </form>
            )}
          </Show>
          <Show when={mode.isError}>
            <span role="alert" class="text-failure">
              {t('computers.claudeLoadFailed')}
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
