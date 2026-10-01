import { Button, Input } from '@ui';
import { createSignal, onMount, Show } from 'solid-js';

/** Mounted afresh with each invite dialog, so every opening mints a new link. */
export function ChannelInviteLink(props: {
  createLink: () => Promise<string>;
}) {
  const [link, setLink] = createSignal<string>();
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [copied, setCopied] = createSignal(false);

  async function generateLink() {
    if (pending()) return;
    setPending(true);
    setError(undefined);
    setCopied(false);
    try {
      setLink(await props.createLink());
    } catch {
      setError('Could not create an invite link. Try again.');
    } finally {
      setPending(false);
    }
  }

  async function copyLink() {
    const value = link();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setError(undefined);
    } catch {
      setError('Could not copy the link. Select and copy it manually.');
    }
  }

  onMount(() => void generateLink());

  return (
    <section
      class="flex flex-col gap-3 border-t border-edge-muted pt-5"
      aria-label="Invite with a link"
    >
      <h3 class="text-sm font-medium text-ink">Invite with a link</h3>
      <p class="text-sm text-ink-muted">
        Anyone with this link can join this channel as an external participant.
        The link expires in 14 days.
      </p>
      <div class="flex items-center gap-2">
        <Input
          aria-label="Channel invite link"
          readOnly
          value={link() ?? ''}
          placeholder={pending() ? 'Creating link…' : 'Invite link unavailable'}
          onClick={(event) => event.currentTarget.select()}
          class="min-w-0 flex-1"
        />
        <Button
          variant="outline"
          disabled={!link() || pending()}
          onClick={() => void copyLink()}
        >
          {copied() ? 'Copied' : 'Copy link'}
        </Button>
      </div>
      <Show when={error()}>
        <p role="alert" class="text-sm text-failure-ink">
          {error()}
        </p>
        <Show when={!link()}>
          <Button
            variant="ghost"
            disabled={pending()}
            onClick={() => void generateLink()}
          >
            Try again
          </Button>
        </Show>
      </Show>
    </section>
  );
}
