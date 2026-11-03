import ChatIcon from '@icon/system/regular/chat-circle.svg';
import TaskIcon from '@icon/system/regular/check-square.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import DatabaseIcon from '@icon/system/regular/database.svg';
import EmailIcon from '@icon/system/regular/envelope.svg';
import DocumentIcon from '@icon/system/regular/file-text.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import { Dynamic } from 'solid-js/web';
import type { FeedItem } from '../core/feed';

const ACTION_ICONS = {
  create_agent: SparkleIcon,
  create_database: DatabaseIcon,
  create_routine: ClockIcon,
  ask_agent: DocumentIcon,
};
export function FeedItemIcon(props: { item: FeedItem; class?: string }) {
  const icon = () => {
    if (props.item.kind === 'idea') return ACTION_ICONS[props.item.action];
    switch (props.item.sourceEntity?.type) {
      case 'email':
        return EmailIcon;
      case 'channel':
        return ChatIcon;
      case 'task':
        return TaskIcon;
      default:
        return ACTION_ICONS[props.item.action];
    }
  };
  return <Dynamic component={icon()} class={props.class} />;
}
