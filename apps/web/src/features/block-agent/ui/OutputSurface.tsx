import Check from '@phosphor/check.svg';
import Copy from '@phosphor/copy.svg';
import { createSignal, type JSX, onCleanup, Show } from 'solid-js';

/** A bounded output pane with an honest copy action and a separate title bar. */
export function OutputSurface(props: {
  label: string;
  text: string;
  trailing?: JSX.Element;
  children: JSX.Element;
}) {
  const [copyState, setCopyState] = createSignal<'idle' | 'copied' | 'failed'>(
    'idle'
  );
  let timeout: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timeout));
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.text);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    clearTimeout(timeout);
    timeout = setTimeout(() => setCopyState('idle'), 2000);
  };
  return (
    <div class="min-w-0 overflow-hidden rounded-lg border border-edge-muted bg-ink/2">
      <div class="flex min-h-9 items-center gap-3 border-b border-edge-muted bg-ink/3 px-3 text-xs text-ink-extra-muted">
        <span>{props.label}</span>
        <span class="ml-auto">{props.trailing}</span>
        <button
          type="button"
          aria-label={
            copyState() === 'copied'
              ? 'Copied'
              : `Copy ${props.label.toLowerCase()}`
          }
          onClick={() => void copy()}
          class="flex size-7 items-center justify-center rounded-md hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <Show
            when={copyState() === 'copied'}
            fallback={<Copy class="size-3.5" />}
          >
            <Check class="size-3.5 text-success" />
          </Show>
        </button>
        <Show when={copyState() === 'failed'}>
          <span role="status">Couldn’t copy</span>
        </Show>
      </div>
      <pre class="max-h-80 overflow-auto px-4 py-3 font-mono text-xs leading-6 whitespace-pre-wrap text-ink-muted wrap-break-word">
        {props.children}
      </pre>
    </div>
  );
}
