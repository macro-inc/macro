import BellIcon from '@icon/system/regular/bell.svg';
import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import ChartIcon from '@icon/system/regular/chart-bar.svg';
import ChatIcon from '@icon/system/regular/chat-circle.svg';
import CheckSquareIcon from '@icon/system/regular/check-square.svg';
import CodeIcon from '@icon/system/regular/code.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import FileTextIcon from '@icon/system/regular/file-text.svg';
import PhoneIcon from '@icon/system/regular/phone.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import TagIcon from '@icon/system/regular/tag.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import { cn } from '@ui';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import type { SuggestionIcon as SuggestionIconName } from '../core/suggestions';

function iconFor(name: SuggestionIconName) {
  return match(name)
    .with('mail', () => EnvelopeIcon)
    .with('tag', () => TagIcon)
    .with('bell', () => BellIcon)
    .with('calendar', () => CalendarIcon)
    .with('task', () => CheckSquareIcon)
    .with('document', () => FileTextIcon)
    .with('chart', () => ChartIcon)
    .with('people', () => UsersIcon)
    .with('phone', () => PhoneIcon)
    .with('code', () => CodeIcon)
    .with('chat', () => ChatIcon)
    .with('sparkle', () => SparkleIcon)
    .exhaustive();
}

/** A suggestion's topic icon in a soft violet tile. */
export function SuggestionIcon(props: {
  name: SuggestionIconName;
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
      <Dynamic component={iconFor(props.name)} class="size-4" />
    </span>
  );
}
