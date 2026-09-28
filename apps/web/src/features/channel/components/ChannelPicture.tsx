import ChannelIcon from '@phosphor/hash-straight.svg';
import { cn } from '@ui';
import { createMemo, createSignal, type JSX, Show } from 'solid-js';

/** Presentation shared by the header, editor, and channel rows. */
export function ChannelPicture(props: {
  url?: string;
  revision?: number;
  class?: string;
  fallback?: JSX.Element;
}) {
  // A refetch permits another attempt at the same URL without reloading healthy images.
  const request = createMemo(() => ({
    url: props.url,
    revision: props.revision,
  }));
  const [failedRequest, setFailedRequest] =
    createSignal<ReturnType<typeof request>>();
  return (
    <span class={cn('inline-flex shrink-0', props.class ?? 'size-6')}>
      <Show
        when={request().url && request() !== failedRequest()}
        fallback={props.fallback ?? <ChannelIcon class="size-full" />}
      >
        <img
          src={request().url}
          alt=""
          class="size-full rounded-lg object-cover"
          onError={() => setFailedRequest(request())}
        />
      </Show>
    </span>
  );
}
