import type { MessageData } from '@core/messages/types';
import { getDisplayName, getInitialsFromName, tryMacroId } from '@core/user';
import { getBotDisplayName } from '@queries/messages/message-sender';
import { Avatar, type AvatarSize } from '@ui';

/** Neutral initials keep the compact entry independent of profile-image loading. */
export function DiscussionAvatar(props: {
  message: MessageData;
  size?: AvatarSize;
}) {
  const name = () =>
    props.message.guest_name ??
    props.message.imported_author?.name ??
    getBotDisplayName(props.message.sender_id, props.message.sender) ??
    getDisplayName(tryMacroId(props.message.sender_id));
  return (
    <Avatar size={props.size ?? 'md'} class="bg-ink/20 text-ink">
      <Avatar.Fallback>{getInitialsFromName(name(), '?')}</Avatar.Fallback>
    </Avatar>
  );
}
