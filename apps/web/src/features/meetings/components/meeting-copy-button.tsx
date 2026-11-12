import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import { isMobile } from '@core/mobile/isMobile';
import Copy from '@icon/system/regular/copy.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import { CopyButton } from '@ui';
import { createSignal, onCleanup, Show } from 'solid-js';

export function MeetingCopyButton(props: {
  url: string;
  onCopy: () => Promise<void>;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [copied, setCopied] = createSignal(false);
  const [error, setError] = createSignal(false);
  const [copying, setCopying] = createSignal(false);
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  async function copy() {
    if (copying()) return false;
    setCopying(true);
    setCopied(false);
    setError(false);
    try {
      await props.onCopy();
      if (disposed) return false;
      setCopied(true);
      return true;
    } catch {
      if (!disposed) setError(true);
      return false;
    } finally {
      if (!disposed) setCopying(false);
    }
  }

  const size = () => {
    if (props.compact) return 'icon-sm';
    return isMobile() ? 'icon-lg' : 'lg';
  };
  return (
    <div class="min-w-0 text-sm text-ink-muted">
      <HeaderIsland class="px-0">
        <CopyButton
          type="button"
          variant="ghost"
          size={size()}
          aria-label="Copy Meeting Url"
          tooltip={{ content: 'Copy Meeting Url', placement: 'top' }}
          disabled={props.disabled || copying()}
          aria-busy={copying()}
          onClick={copy}
        >
          <Show when={props.compact} fallback={<Copy class="size-4" />}>
            <LinkIcon class="size-4" />
          </Show>
          <Show when={!props.compact}>
            <span class="hidden @3xl/call-stage:inline">Copy Meeting Url</span>
          </Show>
        </CopyButton>
      </HeaderIsland>
      <span role="status" class="sr-only">
        {copied() ? 'Meeting URL copied' : ''}
      </span>
      <Show when={error()}>
        <p role="status" class="mt-2 text-xs">
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
      </Show>
    </div>
  );
}
