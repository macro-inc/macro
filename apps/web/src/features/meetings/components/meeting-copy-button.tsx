import { fireAndForget } from '@core/util/fireAndForget';
import Check from '@icon/system/regular/check.svg';
import Copy from '@icon/system/regular/copy.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import { Button } from '@ui';
import { createSignal, onCleanup, Show } from 'solid-js';

export function MeetingCopyButton(props: {
  url: string;
  onCopy: () => Promise<void>;
  disabled?: boolean;
  /** Icon-only, for the call control bar; errors open above the button. */
  compact?: boolean;
}) {
  const [copied, setCopied] = createSignal(false);
  const [error, setError] = createSignal(false);
  const [copying, setCopying] = createSignal(false);
  let reset: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    clearTimeout(reset);
  });

  async function copy() {
    if (copying()) return;
    setCopying(true);
    setError(false);
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
    } finally {
      if (!disposed) setCopying(false);
    }
  }

  return (
    <div
      class="min-w-0 text-sm text-ink-muted"
      classList={{ relative: props.compact }}
    >
      <Show
        when={props.compact}
        fallback={
          <Button
            type="button"
            variant="ghost"
            size="lg"
            disabled={props.disabled || copying()}
            aria-busy={copying()}
            class="bg-hover text-ink not-touch:not-disabled:hover:bg-active focus-visible:outline-2 focus-visible:outline-accent"
            onClick={() => fireAndForget(copy(), 'meetings')}
          >
            <Show when={copied()} fallback={<Copy class="size-4" />}>
              <Check class="size-4" />
            </Show>
            Copy Meeting Url
          </Button>
        }
      >
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          label="Copy Meeting Url"
          tooltipPlacement="top"
          disabled={props.disabled || copying()}
          aria-busy={copying()}
          onClick={() => fireAndForget(copy(), 'meetings')}
        >
          <Show when={copied()} fallback={<LinkIcon />}>
            <Check />
          </Show>
        </Button>
      </Show>
      <span role="status" class="sr-only">
        {copied() ? 'Meeting URL copied' : ''}
      </span>
      <Show when={error()}>
        <div
          classList={{
            'absolute bottom-full left-1/2 mb-2 w-[min(16rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg bg-panel p-2 shadow-sm':
              props.compact,
          }}
        >
          <p
            role="status"
            class="text-xs"
            classList={{ 'mt-2': !props.compact }}
          >
            {props.url
              ? 'Could not copy. Select the URL to copy it manually.'
              : 'Could not load call link. Try again.'}
          </p>
          <Show when={props.url}>
            <input
              aria-label="Call link"
              readOnly
              value={props.url}
              onFocus={(event) => event.currentTarget.select()}
              class="mt-1 w-full bg-transparent text-xs text-ink-muted outline-none"
            />
          </Show>
        </div>
      </Show>
    </div>
  );
}
