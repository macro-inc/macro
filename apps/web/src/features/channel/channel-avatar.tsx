import { useChannelPicture } from '@queries/channel/picture';
import { type JSX, Suspense } from 'solid-js';
import { ChannelPicture } from './components/ChannelPicture';

/** Shared channel avatar without the picture editor's upload dependencies. */
export function ChannelAvatar(props: {
  channelId: string;
  class?: string;
  fallback?: JSX.Element;
}) {
  const picture = useChannelPicture(() => props.channelId);
  return (
    <Suspense fallback={props.fallback}>
      <ChannelPicture
        url={picture.url()}
        revision={picture.revision()}
        class={props.class}
        fallback={props.fallback}
      />
    </Suspense>
  );
}
