import { useUserId } from '@core/context/user';
import { Show } from 'solid-js';
import { createReplySource } from './queries/reply-source';
import {
  ChannelMessagingComposer as Composer,
  type MessagingComposerProps,
} from './views/channel-composer';
import { WhatsappGroupControls } from './views/group-controls';

/** App-facing composition; the composer consumes only its reply capabilities. */
export function ChannelMessagingComposer(
  props: Omit<MessagingComposerProps, 'userId' | 'createSource'>
) {
  const userId = useUserId();
  return (
    <Show
      when={props.interaction.kind === 'group_setup'}
      fallback={
        <Composer
          {...props}
          userId={userId()}
          createSource={createReplySource}
        />
      }
    >
      <WhatsappGroupControls channelId={props.channelId} setupOnly />
    </Show>
  );
}
