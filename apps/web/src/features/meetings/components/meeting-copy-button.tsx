import Copy from '@phosphor/copy.svg';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';

export function MeetingCopyButton(props: {
  url: string;
  onCopy: () => Promise<void>;
}) {
  const [copied, setCopied] = createSignal(false);
  const [error, setError] = createSignal(false);

  async function copy() {
    try {
      await props.onCopy();
      setCopied(true);
      setError(false);
    } catch {
      setCopied(false);
      setError(true);
    }
  }

  return (
    <div class="min-w-0 text-sm text-ink-muted">
      <Button
        type="button"
        variant="ghost"
        size="lg"
        class="bg-hover text-ink not-touch:not-disabled:hover:bg-active focus-visible:outline-2 focus-visible:outline-accent"
        onClick={() => void copy()}
      >
        <Copy class="size-4" />
        {copied() ? 'Copied' : 'Copy Meeting Url'}
      </Button>
      <Show when={error()}>
        <p role="status" class="mt-2 text-xs">
          Could not copy. Select the URL to copy it manually.
        </p>
        <input
          aria-label="Call link"
          readOnly
          value={props.url}
          onFocus={(event) => event.currentTarget.select()}
          class="mt-1 w-full bg-transparent text-xs text-ink-muted outline-none"
        />
      </Show>
    </div>
  );
}
