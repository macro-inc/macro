import ChannelIcon from '@icon/wide-channel.svg';
import { cn } from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';

/** Presentation shared by the header, editor, and channel rows. */
export function ChannelPicture(props: {
  url?: string;
  class?: string;
  fallback?: JSX.Element;
}) {
  const [failedUrl, setFailedUrl] = createSignal<string>();
  return (
    <span class={cn('inline-flex shrink-0', props.class ?? 'size-6')}>
      <Show
        when={props.url && props.url !== failedUrl()}
        fallback={props.fallback ?? <ChannelIcon class="size-full" />}
      >
        <img
          src={props.url}
          alt=""
          class="size-full rounded-lg object-cover"
          onError={() => setFailedUrl(props.url)}
        />
      </Show>
    </span>
  );
}
