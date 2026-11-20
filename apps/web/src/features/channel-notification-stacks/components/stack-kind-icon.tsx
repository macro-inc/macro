import ArrowBendUpLeftIcon from '@icon/system/regular/arrow-bend-up-left.svg';
import AtIcon from '@icon/system/regular/at.svg';
import ChatsCircleIcon from '@icon/system/regular/chats-circle.svg';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import type { ChannelStack } from '../core/channel-stacks';

/** The inbox's kind icons: a reply arrow, an at sign, a speech bubble. */
export function StackKindIcon(props: { stack: ChannelStack; class?: string }) {
  const icon = () =>
    match(props.stack.kind)
      .with('mention', () => AtIcon)
      .with('thread', () =>
        props.stack.mentionsViewer ? AtIcon : ArrowBendUpLeftIcon
      )
      .with('messages', () => ChatsCircleIcon)
      .exhaustive();

  return <Dynamic component={icon()} class={props.class} aria-hidden="true" />;
}
