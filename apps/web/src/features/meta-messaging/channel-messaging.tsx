import { useUserId } from '@core/context/user';
import { createReplySource } from './queries/reply-source';
import {
  ChannelMessagingComposer as Composer,
  type MessagingComposerProps,
} from './views/channel-composer';

/** App-facing composition; the composer consumes only its reply capabilities. */
export function ChannelMessagingComposer(
  props: Omit<MessagingComposerProps, 'userId' | 'createSource'>
) {
  const userId = useUserId();
  return (
    <Composer {...props} userId={userId()} createSource={createReplySource} />
  );
}
