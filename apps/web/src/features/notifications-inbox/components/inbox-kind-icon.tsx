import { t } from '@app/lib/i18n';
import ArrowBendUpLeftIcon from '@icon/system/regular/arrow-bend-up-left.svg';
import AtIcon from '@icon/system/regular/at.svg';
import BellIcon from '@icon/system/regular/bell.svg';
import CalendarBlankIcon from '@icon/system/regular/calendar-blank.svg';
import ChatTeardropIcon from '@icon/system/regular/chat-teardrop.svg';
import ChatsCircleIcon from '@icon/system/regular/chats-circle.svg';
import CheckSquareIcon from '@icon/system/regular/check-square.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import GitPullRequestIcon from '@icon/system/regular/git-pull-request.svg';
import HashIcon from '@icon/system/regular/hash.svg';
import LockKeyIcon from '@icon/system/regular/lock-key.svg';
import RobotIcon from '@icon/system/regular/robot.svg';
import SmileyIcon from '@icon/system/regular/smiley.svg';
import UserPlusIcon from '@icon/system/regular/user-plus.svg';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import type { InboxCardKind } from '../core/inbox-row';

const iconFor = (kind: InboxCardKind) =>
  match(kind)
    .with('channel', () => HashIcon)
    .with('message', () => ChatsCircleIcon)
    .with('mention', () => AtIcon)
    .with('reply', () => ArrowBendUpLeftIcon)
    .with('reaction', () => SmileyIcon)
    .with('email', () => EnvelopeIcon)
    .with('comment', () => ChatTeardropIcon)
    .with('invite', () => UserPlusIcon)
    .with('access', () => LockKeyIcon)
    .with('agent', () => RobotIcon)
    .with('task', () => CheckSquareIcon)
    .with('pull_request', () => GitPullRequestIcon)
    .with('event', () => CalendarBlankIcon)
    .with('reminder', 'other', () => BellIcon)
    .exhaustive();

/** Names a kind of notification: Channel, Email, Comment, Invite… */
export const inboxKindLabel = (kind: InboxCardKind) =>
  match(kind)
    .with('channel', () => t('notificationsInbox.kindChannel'))
    .with('message', () => t('notificationsInbox.kindMessage'))
    .with('mention', () => t('notificationsInbox.kindMention'))
    .with('reply', () => t('notificationsInbox.kindReply'))
    .with('reaction', () => t('notificationsInbox.kindReaction'))
    .with('email', () => t('notificationsInbox.kindEmail'))
    .with('comment', () => t('notificationsInbox.kindComment'))
    .with('invite', () => t('notificationsInbox.kindInvite'))
    .with('access', () => t('notificationsInbox.kindAccess'))
    .with('agent', () => t('notificationsInbox.kindAgent'))
    .with('task', () => t('notificationsInbox.kindTask'))
    .with('pull_request', () => t('notificationsInbox.kindPullRequest'))
    .with('event', () => t('notificationsInbox.kindEvent'))
    .with('reminder', () => t('notificationsInbox.kindReminder'))
    .with('other', () => t('notificationsInbox.kindOther'))
    .exhaustive();

/** The glyph for a kind of notification. */
export function InboxKindIcon(props: { kind: InboxCardKind; class?: string }) {
  return (
    <Dynamic
      component={iconFor(props.kind)}
      class={props.class}
      aria-hidden="true"
    />
  );
}
