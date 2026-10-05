import CheckIcon from '@phosphor/check.svg';
import CopyIcon from '@phosphor/copy.svg';
import { Button } from '@ui';
import { createSignal, onCleanup, Show } from 'solid-js';

const FEEDBACK_MS = 1800;

/** Keeps clipboard feedback local to the file whose path was copied. */
export function CopyFilePathButton(props: {
  path: string;
  onCopy: (path: string) => Promise<boolean>;
}) {
  const [copied, setCopied] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let request = 0;
  onCleanup(() => {
    disposed = true;
    clearTimeout(timer);
  });

  const copy = async () => {
    const current = ++request;
    clearTimeout(timer);
    setCopied(false);
    const success = await props.onCopy(props.path);
    if (disposed || current !== request) return;
    setCopied(success);
    if (success) timer = setTimeout(() => setCopied(false), FEEDBACK_MS);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        tooltip="Copy path"
        aria-label="Copy path"
        class="motion-safe:transition-transform motion-safe:duration-150 motion-safe:active:scale-95"
        onClick={() => void copy()}
      >
        <Show when={copied()} fallback={<CopyIcon />}>
          <CheckIcon class="text-success" />
        </Show>
      </Button>
      <span class="sr-only" aria-live="polite">
        {copied() ? 'Path copied' : ''}
      </span>
    </>
  );
}
