import { useCallLinkQuery } from '@queries/call/meetings';
import { createSignal, Show, Suspense } from 'solid-js';
import { MeetingLink } from '../../meetings/components/meeting-link';
import { useCallContext } from './CallContext';
import { getMeetingUrl } from './call-link';

function ActiveCallLinkContent() {
  const call = useCallContext();
  const link = useCallLinkQuery(() => call.activeCallId() ?? undefined);
  const [copied, setCopied] = createSignal(false);
  const [copyError, setCopyError] = createSignal(false);
  const url = () =>
    link.isSuccess ? getMeetingUrl(link.data.shareToken) : undefined;

  async function copy() {
    const value = url();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <Show
      when={url()}
      fallback={
        <Show
          when={link.isError}
          fallback={<p class="text-xs text-ink-muted">Preparing call link…</p>}
        >
          <button
            type="button"
            class="text-xs text-accent"
            onClick={() => void link.refetch()}
          >
            Could not load call link. Try again
          </button>
        </Show>
      }
    >
      {(url) => (
        <div class="min-w-0">
          <MeetingLink
            url={url()}
            copied={copied()}
            onCopy={() => void copy()}
          />
          <p class="mt-1 text-xs text-ink-muted">
            {copyError()
              ? 'Select the link to copy it manually.'
              : 'Anyone with this link can join, including guests.'}
          </p>
        </div>
      )}
    </Show>
  );
}

export function ActiveCallLink() {
  return (
    <Suspense
      fallback={<p class="text-xs text-ink-muted">Loading call link…</p>}
    >
      <ActiveCallLinkContent />
    </Suspense>
  );
}
