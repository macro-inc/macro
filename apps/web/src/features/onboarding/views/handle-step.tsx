import { isAllowedHandle, mailboxAddress } from '@core/constant/mailbox-handle';
import { fireAndForget } from '@core/util/fireAndForget';
import { createSignal, Show } from 'solid-js';
import { ContinueButton } from '../components/controls';
import { useOnboardingContext } from '../context/onboarding-context';

/** Claims the account's required first-party address before optional imports. */
export function HandleStep(props: { onContinue: () => void }) {
  const context = useOnboardingContext();
  const viewer = context.viewer();
  const claimed = viewer.t === 'signed-in' ? viewer.viewer.handle : undefined;
  const [handle, setHandle] = createSignal(claimed ?? '');
  const [claiming, setClaiming] = createSignal(false);
  const [error, setError] = createSignal<string>();

  const submit = async () => {
    const value = handle();
    if (claiming() || !isAllowedHandle(value)) return;
    setClaiming(true);
    setError();
    try {
      await context.claimHandle(value);
      props.onContinue();
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : 'That handle could not be claimed. Please try another.'
      );
    } finally {
      setClaiming(false);
    }
  };

  return (
    <form
      class="mx-auto flex w-full max-w-sm flex-col gap-6 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        fireAndForget(submit(), 'onboarding');
      }}
    >
      <header class="flex flex-col gap-3 text-center">
        <h1
          tabindex="-1"
          class="font-[Roboto_Slab_Variable] text-3xl font-[315]"
        >
          Choose your Rox handle.
        </h1>
        <p class="text-sm leading-6 text-ink-muted">
          Your handle is your required Rox address. You can import an external
          inbox next, but you do not need one to use your workspace.
        </p>
      </header>
      <label class="flex flex-col gap-2 text-left text-sm font-medium">
        Handle
        <input
          id="onboarding-handle"
          type="text"
          autocomplete="username"
          autofocus
          required
          minlength={3}
          maxlength={32}
          pattern="[a-z0-9._-]+"
          value={handle()}
          disabled={claiming()}
          onInput={(event) => setHandle(event.currentTarget.value)}
          class="min-h-12 rounded-lg border border-edge bg-surface px-4 text-base text-ink disabled:opacity-50"
        />
      </label>
      <Show when={isAllowedHandle(handle())}>
        <p class="text-sm text-ink-muted">{mailboxAddress(handle())}</p>
      </Show>
      <Show when={handle() && !isAllowedHandle(handle())}>
        <p role="alert" class="text-sm text-ink-muted">
          Use 3–32 lowercase letters, numbers, dots, underscores, or hyphens.
          Reserved names, leading or trailing dots, and consecutive dots are not
          allowed.
        </p>
      </Show>
      <Show when={error()}>
        <p role="alert" class="text-sm text-ink-muted">
          {error()}
        </p>
      </Show>
      <ContinueButton
        label={claiming() ? 'Claiming handle…' : 'Continue'}
        disabled={claiming() || !isAllowedHandle(handle())}
        onClick={() => fireAndForget(submit(), 'onboarding')}
      />
    </form>
  );
}
