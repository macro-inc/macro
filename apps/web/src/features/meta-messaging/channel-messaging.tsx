import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableWhatsappLinked } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { Show } from 'solid-js';
import { createLinkedReplySource } from '../whatsapp-linked/queries/reply-source';
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
  const linkedFlag = useFeatureFlag(enableWhatsappLinked);
  const interaction = () =>
    props.interaction.kind === 'external' &&
    props.interaction.account.transport === 'linked' &&
    !linkedFlag().enabled
      ? {
          ...props.interaction,
          account: { ...props.interaction.account, can_reply: false },
        }
      : props.interaction;
  return (
    <Show
      when={props.interaction.kind === 'group_setup'}
      fallback={
        <Composer
          {...props}
          interaction={interaction()}
          userId={userId()}
          createSource={(channelId) =>
            props.interaction.kind === 'external' &&
            props.interaction.account.transport === 'linked'
              ? createLinkedReplySource(channelId)
              : createReplySource(channelId)
          }
        />
      }
    >
      <WhatsappGroupControls channelId={props.channelId} setupOnly />
    </Show>
  );
}
