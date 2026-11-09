import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import ChatIcon from '@icon/system/regular/chat-circle.svg';
import CheckSquareIcon from '@icon/system/regular/check-square.svg';
import CodeIcon from '@icon/system/regular/code.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import FileTextIcon from '@icon/system/regular/file-text.svg';
import PhoneIcon from '@icon/system/regular/phone.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import { cn } from '@ui';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import type { RoutineSurface } from '../core/surfaces';

function iconFor(surface: RoutineSurface) {
  return match(surface)
    .with('email', () => EnvelopeIcon)
    .with('calendar', () => CalendarIcon)
    .with('tasks', () => CheckSquareIcon)
    .with('files', () => FileTextIcon)
    .with('crm', () => UsersIcon)
    .with('chat', () => ChatIcon)
    .with('calls', () => PhoneIcon)
    .with('reviews', () => CodeIcon)
    .with('agents', () => SparkleIcon)
    .exhaustive();
}

/** A suggestion's icon, for the part of the app it belongs to most, in a soft violet tile. */
export function SuggestionIcon(props: {
  surface: RoutineSurface;
  class?: string;
}) {
  return (
    <span
      aria-hidden="true"
      class={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-bg text-violet-ink',
        props.class
      )}
    >
      <Dynamic component={iconFor(props.surface)} class="size-4" />
    </span>
  );
}
