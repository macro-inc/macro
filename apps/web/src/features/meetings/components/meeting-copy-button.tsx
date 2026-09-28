import Check from '@phosphor/check.svg';
import Copy from '@phosphor/copy.svg';
import { Button } from '@ui';
import { createSignal, onCleanup, Show } from 'solid-js';

export function MeetingCopyButton(props: {
  url: string;
  onCopy: () => Promise<void>;
}) {
  const [copied, setCopied] = createSignal(false);
  const [error, setError] = createSignal(false);
  let reset: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    clearTimeout(reset);
  });

  async function copy() {
    try {
      await props.onCopy();
      if (disposed) return;
      clearTimeout(reset);
      setCopied(true);
      setError(false);
      reset = setTimeout(() => setCopied(false), 2500);
    } catch {
      if (disposed) return;
      clearTimeout(reset);
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
        <Show when={copied()} fallback={<Copy class="size-4" />}>
          <Check class="size-4" />
        </Show>
        Copy Meeting Url
      </Button>
      <span role="status" class="sr-only">
        {copied() ? 'Meeting URL copied' : ''}
      </span>
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
