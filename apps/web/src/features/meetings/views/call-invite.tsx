import UserPlus from '@phosphor/user-plus.svg';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';

export function CallInvite(props: {
  onInvite: (email: string) => Promise<void>;
}) {
  const [email, setEmail] = createSignal('');
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal(false);
  const [sent, setSent] = createSignal<string>();
  async function invite() {
    if (pending() || !email().trim()) return;
    setPending(true);
    setError(false);
    setSent(undefined);
    const recipient = email().trim().toLowerCase();
    try {
      await props.onInvite(recipient);
      setSent(recipient);
      setEmail('');
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <div>
      <form
        class="flex items-center gap-2 rounded-lg border border-dashed border-edge-muted p-1"
        onSubmit={(event) => {
          event.preventDefault();
          void invite();
        }}
      >
        <UserPlus class="ml-2 size-4 shrink-0 text-ink-muted" />
        <input
          aria-label="Invite by email"
          type="email"
          required
          value={email()}
          disabled={pending()}
          placeholder="Add people by email…"
          class="min-w-0 flex-1 bg-transparent py-1.5 text-xs outline-none placeholder:text-ink-placeholder"
          onInput={(event) => setEmail(event.currentTarget.value)}
        />
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          disabled={pending() || !email().trim()}
        >
          {pending() ? 'Adding…' : 'Add'}
        </Button>
      </form>
      <Show when={sent()}>
        <p role="status" class="mt-2 text-xs text-ink-muted">
          Invitation queued for {sent()}.
        </p>
      </Show>
      <Show when={error()}>
        <p role="alert" class="mt-2 text-xs text-failure">
          Could not send the invitation. Please try again.
        </p>
      </Show>
    </div>
  );
}
