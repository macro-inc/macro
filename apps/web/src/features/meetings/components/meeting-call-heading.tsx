import { createInlineRename, RenameTitle } from '@ui';
import { ResultAsync } from 'neverthrow';
import { createSignal, onCleanup, onMount } from 'solid-js';

export function MeetingCallHeading(props: {
  title: string;
  onRename?: (title: string) => Promise<void>;
}) {
  const [now, setNow] = createSignal(Date.now());
  onMount(() => {
    const timer = globalThis.setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => globalThis.clearInterval(timer));
  });

  const currentTime = () =>
    new Date(now()).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });

  const titleRename = createInlineRename({
    key: (target: string) => target,
    name: () => props.title,
    rename: (_target, title) =>
      ResultAsync.fromPromise(
        props.onRename?.(title) ?? Promise.resolve(),
        () => 'Could not rename the call. Try again.'
      ),
    failureMessage: (message: string) => message,
  });

  return (
    <div class="min-w-0">
      <div class="flex flex-wrap items-center gap-3">
        <time
          aria-label="Current time"
          dateTime={new Date(now()).toISOString()}
          class="text-sm tabular-nums text-ink-muted"
        >
          {currentTime()}
        </time>
        <h1 class="flex min-w-0 text-lg font-semibold">
          <RenameTitle
            rename={titleRename}
            target="call"
            startOn="click"
            readOnly={!props.onRename}
            aria-label="Call name"
            maxLength={200}
            class="break-words"
          />
        </h1>
      </div>
    </div>
  );
}
