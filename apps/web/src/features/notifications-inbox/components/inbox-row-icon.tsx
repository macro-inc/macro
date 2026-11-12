import ArrowBendUpLeftIcon from '@icon/system/regular/arrow-bend-up-left.svg';
import AtIcon from '@icon/system/regular/at.svg';
import BellIcon from '@icon/system/regular/bell.svg';
import CalendarBlankIcon from '@icon/system/regular/calendar-blank.svg';
import ChatCircleIcon from '@icon/system/regular/chat-circle.svg';
import ChatsCircleIcon from '@icon/system/regular/chats-circle.svg';
import CheckSquareIcon from '@icon/system/regular/check-square.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import GitPullRequestIcon from '@icon/system/regular/git-pull-request.svg';
import LockKeyIcon from '@icon/system/regular/lock-key.svg';
import LockKeyOpenIcon from '@icon/system/regular/lock-key-open.svg';
import RobotIcon from '@icon/system/regular/robot.svg';
import UserPlusIcon from '@icon/system/regular/user-plus.svg';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import type { InboxRow } from '../core/inbox-row';

type RowType = InboxRow<unknown>['type'];

const iconFor = (type: RowType) =>
  match(type)
    .with('agent', () => RobotIcon)
    .with('email', () => EnvelopeIcon)
    .with('channel_mention', 'discussion_mention', () => AtIcon)
    .with('channel_thread', 'discussion_thread', () => ArrowBendUpLeftIcon)
    .with('channel_messages', () => ChatsCircleIcon)
    .with('discussion_messages', () => ChatCircleIcon)
    .with('task', () => CheckSquareIcon)
    .with('pull_request', () => GitPullRequestIcon)
    .with('calendar_event', () => CalendarBlankIcon)
    .with('calendar_join_request', () => UserPlusIcon)
    .with('access_requested', () => LockKeyIcon)
    .with('access_granted', () => LockKeyOpenIcon)
    .with('access_removed', () => LockKeyIcon)
    .with('other', () => BellIcon)
    .exhaustive();

/** The glyph for a kind of notification: reply, mention, task, email… */
export function InboxRowIcon(props: { type: RowType; class?: string }) {
  return (
    <Dynamic
      component={iconFor(props.type)}
      class={props.class}
      aria-hidden="true"
    />
  );
}
