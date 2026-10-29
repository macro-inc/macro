import Calendar from '@icon/system/regular/calendar-blank.svg';
import Message from '@icon/system/regular/chat-circle.svg';
import Task from '@icon/system/regular/check-square.svg';
import Email from '@icon/system/regular/envelope.svg';
import Search from '@icon/system/regular/magnifying-glass.svg';
import Note from '@icon/system/regular/note.svg';
import Sparkle from '@icon/system/regular/sparkle.svg';
import { Dynamic } from 'solid-js/web';
import type { Intent } from '../core/input';

const icons = {
  ai: Sparkle,
  search: Search,
  note: Note,
  task: Task,
  email: Email,
  message: Message,
  calendar: Calendar,
};

export function TypeIcon(props: {
  intent: Intent | undefined;
  class?: string;
}) {
  return (
    <Dynamic
      component={icons[props.intent ?? 'ai']}
      class={props.class}
      aria-hidden="true"
    />
  );
}
