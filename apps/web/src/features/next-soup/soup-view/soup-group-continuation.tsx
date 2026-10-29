import { useInfiniteScrollSentinel } from '@app/lib/primitives/infinite-scroll-sentinel';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';

/**
 * The end of a group with more items on the server. It requests the next page
 * whenever it is near the visible area and idle; a failed page waits for Retry.
 */
export function SoupGroupContinuation(props: {
  isLoading: boolean;
  failed: boolean;
  onLoad: () => void;
}) {
  const [row, setRow] = createSignal<HTMLDivElement>();
  useInfiniteScrollSentinel({
    sentinel: row,
    hasNextPage: () => !props.failed,
    isFetchingNextPage: () => props.isLoading,
    fetchNextPage: () => props.onLoad(),
  });

  return (
    <div
      ref={setRow}
      aria-busy={!props.failed}
      class="my-1 flex min-h-9 items-center justify-center gap-2 text-sm text-ink-muted"
    >
      <Show
        when={props.failed}
        fallback={<SpinnerIcon class="size-4 animate-spin" />}
      >
        <span>Couldn’t load more items.</span>
        <Button variant="secondary" size="xs" onClick={() => props.onLoad()}>
          Retry
        </Button>
      </Show>
    </div>
  );
}
